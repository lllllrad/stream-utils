// Opt-in smoke test against an installed OBS 32.2.2 core, without devices or GUI.
// Function signatures: obsproject/obs-studio tag 32.2.2, libobs/obs.h.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// Version-pinned ABI layouts from OBS 32.2.2. No capture/third-party modules are loaded.
struct video_info {
    const char *graphics_module;
    uint32_t fps_num, fps_den, base_width, base_height, output_width, output_height;
    int output_format;
    uint32_t adapter;
    bool gpu_conversion;
    int colorspace, range, scale_type;
};
struct source_frame {
    uint8_t *data[8];
    uint32_t linesize[8];
    uint32_t width, height;
    uint64_t timestamp;
    int format;
    float color_matrix[16];
    bool full_range;
    uint16_t max_luminance;
    float color_range_min[3], color_range_max[3];
    bool flip;
    uint8_t flags, trc;
    volatile long refs;
    bool prev_frame;
};
// obs_register_source_s accepts the size of the supported prefix.
struct source_info_prefix {
    const char *id;
    int type;
    uint32_t output_flags;
    const char *(*get_name)(void *);
    void *(*create)(void *, void *);
    void (*destroy)(void *);
    uint32_t (*get_width)(void *);
    uint32_t (*get_height)(void *);
};
static const char *synthetic_name(void *data) { (void)data; return "Synthetic smoke input"; }
static void *synthetic_create(void *settings, void *source) { (void)settings; return source; }
static void synthetic_destroy(void *data) { (void)data; }

static bool read_record(const char *dir, unsigned long long *count, long long *timestamp, char *record_name) {
    char pattern[32768], full[32768];
    WIN32_FIND_DATAA entry;
    snprintf(pattern, sizeof(pattern), "%s\\obs-frame-heartbeat-native-*.txt", dir);
    HANDLE search = FindFirstFileA(pattern, &entry);
    if (search == INVALID_HANDLE_VALUE) return false;
    snprintf(full, sizeof(full), "%s\\%s", dir, entry.cFileName);
    FindClose(search);
    FILE *file = fopen(full, "rb");
    if (!file) return false;
    int fields = fscanf(file, "%255[^\t]\t%llu\t%lld", record_name, count, timestamp);
    fclose(file);
    return fields == 3;
}

static bool emit_frames(void *source, void (*output)(void *, const struct source_frame *)) {
    static uint8_t pixels[64 * 64 * 4];
    for (size_t i = 0; i < sizeof(pixels); i += 4) { pixels[i] = 32; pixels[i + 1] = 64; pixels[i + 2] = 128; pixels[i + 3] = 255; }
    struct source_frame frame = {0};
    frame.data[0] = pixels;
    frame.linesize[0] = 64 * 4;
    frame.width = frame.height = 64;
    frame.format = 7; // VIDEO_FORMAT_BGRA in OBS 32.2.2.
    frame.full_range = true;
    LARGE_INTEGER frequency, tick;
    if (!QueryPerformanceFrequency(&frequency)) return false;
    for (unsigned i = 0; i < 60; i++) {
        QueryPerformanceCounter(&tick);
        frame.timestamp = (uint64_t)((double)tick.QuadPart * 1000000000.0 / (double)frequency.QuadPart);
        output(source, &frame);
        Sleep(33);
    }
    return true;
}

typedef bool (*startup_fn)(const char *, const char *, void *);
typedef void (*shutdown_fn)(void);
typedef const char *(*version_fn)(void);
typedef int (*open_module_fn)(void **, const char *, const char *);
typedef bool (*init_module_fn)(void *);
typedef bool (*enum_filters_fn)(size_t, const char **);
typedef const char *(*display_name_fn)(const char *);
typedef void *(*create_fn)(const char *, const char *, void *);
typedef uint32_t (*flags_fn)(const void *);
typedef void (*release_fn)(void *);
typedef void (*data_path_fn)(const char *);
typedef int (*reset_video_fn)(struct video_info *);
typedef void (*register_fn)(const struct source_info_prefix *, size_t);
typedef void (*output_source_fn)(uint32_t, void *);
typedef void (*filter_fn)(void *, void *);
typedef void (*output_video_fn)(void *, const struct source_frame *);
typedef void (*rename_fn)(void *, const char *);
typedef bool (*showing_fn)(const void *);

#define LOAD(type, name) type name = (type)(void *)GetProcAddress(core, #name); \
    if (!name) { fprintf(stderr, "Missing OBS export: %s\n", #name); return 1; }

int main(int argc, char **argv) {
    if (argc != 4) {
        fprintf(stderr, "Usage: probe-obs-test.exe OBS_BIN_DIR PLUGIN_DLL HEARTBEAT_DIR\n");
        return 1;
    }
    if (!SetDllDirectoryA(argv[1]) || !SetEnvironmentVariableA("OBS_HEARTBEAT_DIR", argv[3])) return 1;
    char core_path[32768];
    if (snprintf(core_path, sizeof(core_path), "%s\\obs.dll", argv[1]) >= (int)sizeof(core_path)) return 1;
    HMODULE core = LoadLibraryExA(core_path, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!core) { fprintf(stderr, "Cannot load obs.dll: %lu\n", GetLastError()); return 1; }
    LOAD(startup_fn, obs_startup);
    LOAD(shutdown_fn, obs_shutdown);
    LOAD(version_fn, obs_get_version_string);
    LOAD(open_module_fn, obs_open_module);
    LOAD(init_module_fn, obs_init_module);
    LOAD(enum_filters_fn, obs_enum_filter_types);
    LOAD(display_name_fn, obs_source_get_display_name);
    LOAD(create_fn, obs_source_create_private);
    LOAD(flags_fn, obs_source_get_output_flags);
    LOAD(release_fn, obs_source_release);
    LOAD(data_path_fn, obs_add_data_path);
    LOAD(reset_video_fn, obs_reset_video);
    LOAD(register_fn, obs_register_source_s);
    LOAD(output_source_fn, obs_set_output_source);
    LOAD(filter_fn, obs_source_filter_add);
    LOAD(filter_fn, obs_source_filter_remove);
    LOAD(output_video_fn, obs_source_output_video);
    LOAD(rename_fn, obs_source_set_name);
    LOAD(showing_fn, obs_source_showing);
    printf("Installed OBS core: %s\n", obs_get_version_string());
    if (strcmp(obs_get_version_string(), "32.2.2") != 0) {
        fprintf(stderr, "Only OBS 32.2.2 is supported by this smoke test.\n");
        return 1;
    }
    if (!obs_startup("en-US", NULL, NULL)) { fprintf(stderr, "obs_startup failed\n"); return 1; }
    int result = 1;
    void *source = NULL, *probe = NULL;
    char data_path[32768];
    snprintf(data_path, sizeof(data_path), "%s/../../data/libobs/", argv[1]);
    for (char *p = data_path; *p; p++) if (*p == '\\') *p = '/';
    obs_add_data_path(data_path);
    struct video_info video = { .graphics_module = "libobs-d3d11", .fps_num = 30, .fps_den = 1,
        .base_width = 64, .base_height = 64, .output_width = 64, .output_height = 64,
        .output_format = 7, .colorspace = 3, .range = 2 };
    int video_result = obs_reset_video(&video);
    printf("obs_reset_video (D3D11): %d\n", video_result);
    if (video_result != 0) goto cleanup;
    void *module = NULL;
    int opened = obs_open_module(&module, argv[2], argv[3]);
    printf("obs_open_module: %d\n", opened);
    if (opened != 0 || !obs_init_module(module)) { fprintf(stderr, "Module initialization failed\n"); goto cleanup; }
    const char *id = NULL;
    bool found = false;
    for (size_t i = 0; obs_enum_filter_types(i, &id); i++) {
        if (strcmp(id, "frame_arrival_probe_native") == 0) found = true;
    }
    if (!found) { fprintf(stderr, "Probe filter was not registered\n"); goto cleanup; }
    const char *name = obs_source_get_display_name("frame_arrival_probe_native");
    if (!name || strcmp(name, "Frame Arrival Probe (Native)") != 0) goto cleanup;
    printf("Registered filter: %s\n", name);
    for (unsigned i = 0; i < 100; i++) {
        void *filter = obs_source_create_private("frame_arrival_probe_native", "smoke probe", NULL);
        if (!filter) { fprintf(stderr, "Filter creation failed at %u\n", i); goto cleanup; }
        uint32_t flags = obs_source_get_output_flags(filter);
        obs_source_release(filter);
        if (flags != 5) { fprintf(stderr, "Unexpected filter output flags: %u\n", flags); goto cleanup; }
    }
    puts("PASS: 100 filter create/release cycles");
    struct source_info_prefix synthetic = { .id = "watchdog_smoke_async", .type = 0, .output_flags = 5,
        .get_name = synthetic_name, .create = synthetic_create, .destroy = synthetic_destroy };
    obs_register_source_s(&synthetic, sizeof(synthetic));
    source = obs_source_create_private(synthetic.id, "smoke input", NULL);
    probe = obs_source_create_private("frame_arrival_probe_native", "attached smoke probe", NULL);
    if (!source || !probe) goto cleanup;
    obs_source_filter_add(source, probe);
    obs_set_output_source(0, source);
    if (!emit_frames(source, obs_source_output_video)) goto cleanup;
    unsigned long long first, second;
    long long first_time, second_time;
    char record_name[256];
    if (!read_record(argv[3], &first, &first_time, record_name) || !first || strcmp(record_name, "smoke input") != 0) goto cleanup;
    if (!emit_frames(source, obs_source_output_video)) goto cleanup;
    if (!read_record(argv[3], &second, &second_time, record_name) || second <= first) goto cleanup;
    printf("PASS: identical pixels still increment frame count (%llu -> %llu)\n", first, second);
    Sleep(1500); // Drain queued async frames before testing a stopped producer.
    if (!read_record(argv[3], &first, &first_time, record_name)) goto cleanup;
    Sleep(1500);
    if (!read_record(argv[3], &second, &second_time, record_name) || second != first || second_time <= first_time) goto cleanup;
    printf("PASS: stopped input keeps count %llu while heartbeat timestamp advances (%lld -> %lld)\n", first, first_time, second_time);
    const char *renamed = "smoke-\xed\x99\x94\xeb\xa9\xb4"; // UTF-8 Korean source name.
    obs_source_set_name(source, renamed);
    Sleep(1200);
    if (!read_record(argv[3], &second, &second_time, record_name) || strcmp(record_name, renamed) != 0) goto cleanup;
    puts("PASS: UTF-8 source rename reaches heartbeat");
    obs_set_output_source(0, NULL);
    Sleep(200);
    if (obs_source_showing(source)) goto cleanup;
    puts("PASS: hidden source reports videoShowing=false");
    obs_source_filter_remove(source, probe);
    obs_source_release(probe);
    probe = NULL;
    Sleep(200);
    if (read_record(argv[3], &second, &second_time, record_name)) goto cleanup;
    puts("PASS: filter removal deletes heartbeat file");
    result = 0;
cleanup:
    obs_set_output_source(0, NULL);
    if (source) obs_source_release(source);
    if (probe) obs_source_release(probe);
    obs_shutdown();
    FreeLibrary(core);
    if (!result) puts("Installed OBS D3D11 module smoke test passed. GUI, capture devices and watchdog recovery were not tested.");
    else fprintf(stderr, "Installed OBS smoke test failed; inspect the last completed PASS stage.\n");
    return result;
}
