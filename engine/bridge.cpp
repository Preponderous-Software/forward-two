// Forward Two's render bridge: a Strata web-kit host that draws what the page
// hands it. The game (world, boats, rivers, people) lives in JavaScript under
// web/src; this file keeps copies of the static data (terrain, meshes,
// textures) so it can rebuild them after a lost WebGL context, and turns the
// page's per-frame rows into kit batches.
//
// Every export takes pointers into the module's heap that the page filled
// (see web/src/render/bridge.js). Row layouts are documented beside each.
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include <cmath>
#include <cstring>
#include <string>
#include <vector>

namespace {

struct Terrain {
    std::vector<float> heights, colors;
    int nx = 0, nz = 0;
    float cell = 1.0f, origin[3] = {0, 0, 0};
};

struct MeshSlot {
    bool used = false;
    bool visible = true;
    std::vector<float> positions, normals, colors, uvs;  // colours RGB per vertex
    std::vector<uint32_t> indices;
    float color[4] = {1, 1, 1, 1};
    uint32_t flags = 0;
    int texture = -1;  // a texture slot, or -1
    float model[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    bool hasModel = false;
    uint32_t engineId = 0;
};

struct TextureSlot {
    bool used = false;
    int w = 0, h = 0;
    uint32_t flags = 0;
    std::vector<uint8_t> rgba;
    uint32_t engineId = 0;
};

Terrain terrain;
std::vector<MeshSlot> meshes;
std::vector<TextureSlot> textures;

// Per-frame batches, replaced by the page each frame.
std::vector<float> itemRows, pointRows, lineRows, wideRows, lightRows, labelRows, rectRows, textRows;
std::string labelText, screenText;
float levels[10] = {1, 1, 1, 0, 0, 0, 1, 1, 1, 1};  // ambient tint, lift, sun intensity, sun tint
float clearRgba[4] = {0.55f, 0.7f, 0.85f, 1.0f};
bool useSkyClear = true;
const float kHidden[16] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -10000, 0, 1};

void uploadTerrain(strata_kit::Host& h) {
    if (!h.engine || terrain.nx < 2) return;
    StrataTerrainTile tile{};
    std::memcpy(tile.origin, terrain.origin, sizeof tile.origin);
    tile.cell_size = terrain.cell;
    tile.samples_x = terrain.nx;
    tile.samples_z = terrain.nz;
    tile.heights = terrain.heights.data();
    tile.colors = terrain.colors.empty() ? nullptr : terrain.colors.data();
    tile.color[0] = tile.color[1] = tile.color[2] = 0.5f;
    tile.color[3] = 1.0f;
    if (strata_set_terrain(h.engine, &tile) != STRATA_OK)
        std::fprintf(stderr, "forward-two: terrain refused: %s\n", strata_last_error());
    h.terrainSamples = terrain.nx * terrain.nz;
}

void uploadTexture(strata_kit::Host& h, TextureSlot& t) {
    if (!h.engine) return;
    t.engineId = 0;
    if (strata_create_texture_rgba8(h.engine, t.w, t.h, t.rgba.data(), t.flags, &t.engineId) != STRATA_OK)
        std::fprintf(stderr, "forward-two: texture refused: %s\n", strata_last_error());
}

void applyTransform(strata_kit::Host& h, MeshSlot& m) {
    if (!h.engine || !m.engineId) return;
    if (!m.visible) {
        strata_set_mesh_transform(h.engine, m.engineId, kHidden);
    } else if (m.hasModel) {
        strata_set_mesh_transform(h.engine, m.engineId, m.model);
    }
}

void uploadMesh(strata_kit::Host& h, MeshSlot& m) {
    if (!h.engine) return;
    m.engineId = 0;
    StrataTexturedMesh tm{};
    tm.mesh.positions = m.positions.data();
    tm.mesh.normals = m.normals.empty() ? nullptr : m.normals.data();
    tm.mesh.colors = m.colors.empty() ? nullptr : m.colors.data();
    tm.mesh.indices = m.indices.data();
    tm.mesh.vertex_count = static_cast<int32_t>(m.positions.size() / 3);
    tm.mesh.index_count = static_cast<int32_t>(m.indices.size());
    std::memcpy(tm.mesh.color, m.color, sizeof m.color);
    tm.uvs = m.uvs.empty() ? nullptr : m.uvs.data();
    tm.texture = (m.texture >= 0 && m.texture < static_cast<int>(textures.size())) ? textures[m.texture].engineId : 0;
    tm.flags = m.flags;
    if (strata_add_textured_mesh(h.engine, &tm, &m.engineId) != STRATA_OK) {
        std::fprintf(stderr, "forward-two: mesh refused: %s\n", strata_last_error());
        m.engineId = 0;
        return;
    }
    applyTransform(h, m);
}

int countMeshes() {
    int n = 0;
    for (auto& m : meshes) n += (m.used && m.engineId) ? 1 : 0;
    return n;
}

}  // namespace

void strata_kit_configure(strata_kit::Options& o) {
    o.name = "forward-two";
    o.fovDegrees = 62.0f;
    o.nearPlane = 0.6f;
    o.farPlane = 3200.0f;
    o.shadowDistanceMin = 160.0f;
    o.shadowDistancePerDist = 6.0f;
    o.fog = true;
    o.tiers[0] = {0, 1024, 4, true};
    o.tiers[1] = {2, 1024, 8, false};
    o.tiers[2] = {3, 2048, 16, false};
}

void strata_kit_engine_ready(strata_kit::Host& h) {
    uploadTerrain(h);
    for (auto& t : textures)
        if (t.used) uploadTexture(h, t);
    for (auto& m : meshes)
        if (m.used) uploadMesh(h, m);
    h.meshes = countMeshes();
}

void strata_kit_build(strata_kit::Host& h, double) {
    using strata_kit::Rgb;
    h.ambientTint = {levels[0], levels[1], levels[2]};
    h.ambientLift = {levels[3], levels[4], levels[5]};
    h.sunIntensity = levels[6];
    h.sunTint = {levels[7], levels[8], levels[9]};
    if (!useSkyClear) {
        h.clearFlags = STRATA_CLEAR_COLOR | STRATA_CLEAR_DEPTH;
        std::memcpy(h.clearColor, clearRgba, sizeof clearRgba);
    }
    // items: kind, x, y, z, sx, sy, sz, r, g, b  (10)
    for (size_t i = 0; i + 10 <= itemRows.size(); i += 10) {
        const float* r = &itemRows[i];
        h.add(static_cast<int>(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], {r[7], r[8], r[9]});
    }
    // points: x, y, z, sizePx, worldDiameter, r, g, b, a, flags  (10)
    for (size_t i = 0; i + 10 <= pointRows.size(); i += 10) {
        const float* r = &pointRows[i];
        h.point(r[0], r[1], r[2], r[3], r[4], {r[5], r[6], r[7]}, r[8], static_cast<uint32_t>(r[9]));
    }
    // lines: x0, y0, z0, x1, y1, z1, r, g, b, a  (10)
    for (size_t i = 0; i + 10 <= lineRows.size(); i += 10) {
        const float* r = &lineRows[i];
        h.line(r[0], r[1], r[2], r[3], r[4], r[5], {r[6], r[7], r[8]}, r[9]);
    }
    // wide lines: x0, y0, z0, x1, y1, z1, r, g, b, a, px, world, flags  (13)
    for (size_t i = 0; i + 13 <= wideRows.size(); i += 13) {
        const float* r = &wideRows[i];
        h.wideLine(r[0], r[1], r[2], r[3], r[4], r[5], {r[6], r[7], r[8]}, r[10], r[11], r[9],
                   static_cast<uint32_t>(r[12]));
    }
    // lights: x, y, z, range, r, g, b, intensity, priority, liftR, liftG, liftB  (12)
    for (size_t i = 0; i + 12 <= lightRows.size(); i += 12) {
        const float* r = &lightRows[i];
        if (r[9] > 0 || r[10] > 0 || r[11] > 0) {
            StrataPointLight l{};
            l.position[0] = r[0];
            l.position[1] = r[1];
            l.position[2] = r[2];
            l.range = r[3];
            l.color[0] = r[4];
            l.color[1] = r[5];
            l.color[2] = r[6];
            l.intensity = r[7];
            h.fill(l, {r[9], r[10], r[11]}, static_cast<int>(r[8]));
        } else {
            h.light(r[0], r[1], r[2], r[3], {r[4], r[5], r[6]}, r[7], static_cast<int>(r[8]));
        }
    }
    // labels: x, y, z, pixelSize, r, g, b, a  (8) + labelText split on '\n' ... one label per '\x1f'
    {
        size_t start = 0, k = 0;
        for (size_t i = 0; i + 8 <= labelRows.size(); i += 8, ++k) {
            size_t end = labelText.find('\x1f', start);
            if (end == std::string::npos) end = labelText.size();
            const std::string s = labelText.substr(start, end - start);
            start = end + 1;
            const float* r = &labelRows[i];
            h.label(r[0], r[1], r[2], s.c_str(), r[3], {r[4], r[5], r[6]}, r[7]);
        }
    }
}

// ------------------------------------------------------------------ exports

// Heights row by row along +Z; colours linear RGB per sample (or null).
STRATA_KIT_EXPORT void f2_set_terrain(const float* heights, const float* colors, int nx, int nz, float cell, float ox,
                                      float oy, float oz) {
    terrain.nx = nx;
    terrain.nz = nz;
    terrain.cell = cell;
    terrain.origin[0] = ox;
    terrain.origin[1] = oy;
    terrain.origin[2] = oz;
    terrain.heights.assign(heights, heights + static_cast<size_t>(nx) * nz);
    if (colors)
        terrain.colors.assign(colors, colors + static_cast<size_t>(nx) * nz * 3);
    else
        terrain.colors.clear();
    uploadTerrain(strata_kit::host());
}

// A texture slot (RGBA8, w*h*4 bytes). Returns the slot.
STRATA_KIT_EXPORT int f2_texture_create(const uint8_t* rgba, int w, int h, int flags) {
    TextureSlot t;
    t.used = true;
    t.w = w;
    t.h = h;
    t.flags = static_cast<uint32_t>(flags);
    t.rgba.assign(rgba, rgba + static_cast<size_t>(w) * h * 4);
    textures.push_back(std::move(t));
    uploadTexture(strata_kit::host(), textures.back());
    return static_cast<int>(textures.size()) - 1;
}

// Replace a texture's texels (the whole image).
STRATA_KIT_EXPORT void f2_texture_update(int slot, const uint8_t* rgba) {
    if (slot < 0 || slot >= static_cast<int>(textures.size())) return;
    TextureSlot& t = textures[slot];
    std::memcpy(t.rgba.data(), rgba, t.rgba.size());
    strata_kit::Host& h = strata_kit::host();
    if (h.engine && t.engineId) strata_update_texture_rgba8(h.engine, t.engineId, 0, 0, t.w, t.h, t.rgba.data());
}

// A mesh in its own space. normals/colors/uvs may be null. colour = rgba base.
// flags: STRATA_MESH_* bits. texture: a texture slot or -1. Returns the slot.
STRATA_KIT_EXPORT int f2_mesh_add(const float* positions, const float* normals, const float* colors, const float* uvs,
                                  const uint32_t* indices, int nv, int ni, float r, float g, float b, float a,
                                  int flags, int texture) {
    int slot = -1;
    for (size_t i = 0; i < meshes.size(); ++i)
        if (!meshes[i].used) {
            slot = static_cast<int>(i);
            break;
        }
    if (slot < 0) {
        meshes.emplace_back();
        slot = static_cast<int>(meshes.size()) - 1;
    }
    MeshSlot& m = meshes[slot];
    m = MeshSlot{};
    m.used = true;
    m.positions.assign(positions, positions + static_cast<size_t>(nv) * 3);
    if (normals) m.normals.assign(normals, normals + static_cast<size_t>(nv) * 3);
    if (colors) m.colors.assign(colors, colors + static_cast<size_t>(nv) * 3);
    if (uvs) m.uvs.assign(uvs, uvs + static_cast<size_t>(nv) * 2);
    m.indices.assign(indices, indices + ni);
    m.color[0] = r;
    m.color[1] = g;
    m.color[2] = b;
    m.color[3] = a;
    m.flags = static_cast<uint32_t>(flags);
    m.texture = texture;
    strata_kit::Host& h = strata_kit::host();
    uploadMesh(h, m);
    h.meshes = countMeshes();
    return slot;
}

STRATA_KIT_EXPORT void f2_mesh_remove(int slot) {
    if (slot < 0 || slot >= static_cast<int>(meshes.size()) || !meshes[slot].used) return;
    strata_kit::Host& h = strata_kit::host();
    if (h.engine && meshes[slot].engineId) strata_remove_mesh(h.engine, meshes[slot].engineId);
    meshes[slot] = MeshSlot{};
    h.meshes = countMeshes();
}

// Column-major 4x4 model matrix.
STRATA_KIT_EXPORT void f2_mesh_transform(int slot, const float* m16) {
    if (slot < 0 || slot >= static_cast<int>(meshes.size()) || !meshes[slot].used) return;
    MeshSlot& m = meshes[slot];
    std::memcpy(m.model, m16, sizeof m.model);
    m.hasModel = true;
    applyTransform(strata_kit::host(), m);
}

STRATA_KIT_EXPORT void f2_mesh_visible(int slot, int visible) {
    if (slot < 0 || slot >= static_cast<int>(meshes.size()) || !meshes[slot].used) return;
    MeshSlot& m = meshes[slot];
    const bool v = visible != 0;
    if (v == m.visible) return;
    m.visible = v;
    if (v && !m.hasModel) {
        static const float kId[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
        std::memcpy(m.model, kId, sizeof m.model);
        m.hasModel = true;
    }
    applyTransform(strata_kit::host(), m);
}

// Per-frame rows (see strata_kit_build for each layout).
STRATA_KIT_EXPORT void f2_items(const float* rows, int n) { itemRows.assign(rows, rows + static_cast<size_t>(n) * 10); }
STRATA_KIT_EXPORT void f2_points(const float* rows, int n) { pointRows.assign(rows, rows + static_cast<size_t>(n) * 10); }
STRATA_KIT_EXPORT void f2_lines(const float* rows, int n) { lineRows.assign(rows, rows + static_cast<size_t>(n) * 10); }
STRATA_KIT_EXPORT void f2_wide_lines(const float* rows, int n) {
    wideRows.assign(rows, rows + static_cast<size_t>(n) * 13);
}
STRATA_KIT_EXPORT void f2_lights(const float* rows, int n) { lightRows.assign(rows, rows + static_cast<size_t>(n) * 12); }
STRATA_KIT_EXPORT void f2_labels(const float* rows, int n, const char* text) {
    labelRows.assign(rows, rows + static_cast<size_t>(n) * 8);
    labelText = text ? text : "";
}

// ambient tint rgb, ambient lift rgb, sun intensity, sun tint rgb
STRATA_KIT_EXPORT void f2_levels(const float* l10) { std::memcpy(levels, l10, sizeof levels); }

// sky = 1 keeps the engine's sky; otherwise clear to rgba.
STRATA_KIT_EXPORT void f2_clear(int sky, float r, float g, float b) {
    useSkyClear = sky != 0;
    clearRgba[0] = r;
    clearRgba[1] = g;
    clearRgba[2] = b;
    clearRgba[3] = 1.0f;
}

STRATA_KIT_EXPORT int f2_mesh_count() { return countMeshes(); }
