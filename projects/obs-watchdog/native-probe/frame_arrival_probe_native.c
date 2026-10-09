// 네이티브 OBS 플러그인: 소스에 필터로 붙여서 실제 프레임 도착 횟수를 센다.
// filter_video는 실제로 디바이스가 새 프레임을 줄 때마다 호출되므로
// (픽셀 내용이 똑같아도 호출됨) 정지 화면/무음과 무관하게 "fps가 나오고 있는지"를
// 판단할 수 있는 유일한 신뢰 가능한 신호다.
//
// obs.lib 없이 obs.dll에서 GetProcAddress로 직접 필요한 함수만 가져와서 쓴다
// (이미 OBS 프로세스 안에서 로드되므로 LoadLibrary 불필요, GetModuleHandle로 충분).
//
// ABI는 obs-studio 32.2.2 (libobs/obs.h, obs-source.h, obs-config.h)에서 그대로 가져옴.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <wchar.h>

// ---- 최소 opaque 타입 (실제 레이아웃을 몰라도 포인터로만 다루면 안전) ----
typedef struct obs_source obs_source_t;
typedef struct obs_data obs_data_t;
typedef struct obs_properties obs_properties_t;
typedef struct gs_effect gs_effect_t;
typedef struct obs_module obs_module_t;
typedef struct obs_missing_files obs_missing_files_t;
struct obs_audio_data;
struct obs_source_audio_mix;
struct audio_output_data;
struct obs_mouse_event;
struct obs_key_event;
struct obs_source_frame; // 내용을 안 보고 그대로 통과시키므로 opaque로 충분

typedef void (*obs_source_enum_proc_t)(obs_source_t *parent, obs_source_t *child, void *param);

enum obs_source_type { OBS_SOURCE_TYPE_INPUT, OBS_SOURCE_TYPE_FILTER, OBS_SOURCE_TYPE_TRANSITION, OBS_SOURCE_TYPE_SCENE };
enum obs_icon_type { OBS_ICON_TYPE_PLACEHOLDER = 0 };
enum obs_media_state { OBS_MEDIA_STATE_PLACEHOLDER = 0 };
enum gs_color_space { GS_CS_PLACEHOLDER = 0 };

#define OBS_SOURCE_VIDEO (1 << 0)
#define OBS_SOURCE_ASYNC (1 << 2)
#define OBS_SOURCE_ASYNC_VIDEO (OBS_SOURCE_ASYNC | OBS_SOURCE_VIDEO)

// libobs/obs-source.h (obs-studio 32.2.2)의 struct obs_source_info을 그대로 옮긴 것.
// 필드 순서/타입이 실제 OBS와 정확히 일치해야 ABI가 맞는다.
struct obs_source_info {
	const char *id;
	enum obs_source_type type;
	uint32_t output_flags;
	const char *(*get_name)(void *type_data);
	void *(*create)(obs_data_t *settings, obs_source_t *source);
	void (*destroy)(void *data);
	uint32_t (*get_width)(void *data);
	uint32_t (*get_height)(void *data);
	void (*get_defaults)(obs_data_t *settings);
	obs_properties_t *(*get_properties)(void *data);
	void (*update)(void *data, obs_data_t *settings);
	void (*activate)(void *data);
	void (*deactivate)(void *data);
	void (*show)(void *data);
	void (*hide)(void *data);
	void (*video_tick)(void *data, float seconds);
	void (*video_render)(void *data, gs_effect_t *effect);
	struct obs_source_frame *(*filter_video)(void *data, struct obs_source_frame *frame);
	struct obs_audio_data *(*filter_audio)(void *data, struct obs_audio_data *audio);
	void (*enum_active_sources)(void *data, obs_source_enum_proc_t enum_callback, void *param);
	void (*save)(void *data, obs_data_t *settings);
	void (*load)(void *data, obs_data_t *settings);
	void (*mouse_click)(void *data, const struct obs_mouse_event *event, int32_t type, bool mouse_up, uint32_t click_count);
	void (*mouse_move)(void *data, const struct obs_mouse_event *event, bool mouse_leave);
	void (*mouse_wheel)(void *data, const struct obs_mouse_event *event, int x_delta, int y_delta);
	void (*focus)(void *data, bool focus);
	void (*key_click)(void *data, const struct obs_key_event *event, bool key_up);
	void (*filter_remove)(void *data, obs_source_t *source);
	void *type_data;
	void (*free_type_data)(void *type_data);
	bool (*audio_render)(void *data, uint64_t *ts_out, struct obs_source_audio_mix *audio_output, uint32_t mixers, size_t channels, size_t sample_rate);
	void (*enum_all_sources)(void *data, obs_source_enum_proc_t enum_callback, void *param);
	void (*transition_start)(void *data);
	void (*transition_stop)(void *data);
	void (*get_defaults2)(void *type_data, obs_data_t *settings);
	obs_properties_t *(*get_properties2)(void *data, void *type_data);
	bool (*audio_mix)(void *data, uint64_t *ts_out, struct audio_output_data *audio_output, size_t channels, size_t sample_rate);
	enum obs_icon_type icon_type;
	void (*media_play_pause)(void *data, bool pause);
	void (*media_restart)(void *data);
	void (*media_stop)(void *data);
	void (*media_next)(void *data);
	void (*media_previous)(void *data);
	int64_t (*media_get_duration)(void *data);
	int64_t (*media_get_time)(void *data);
	void (*media_set_time)(void *data, int64_t miliseconds);
	enum obs_media_state (*media_get_state)(void *data);
	uint32_t version;
	const char *unversioned_id;
	obs_missing_files_t *(*missing_files)(void *data);
	enum gs_color_space (*video_get_color_space)(void *data, size_t count, const enum gs_color_space *preferred_spaces);
	void (*filter_add)(void *data, obs_source_t *source);
	const char *(*get_dark_icon)(void *type_data);
	const char *(*get_light_icon)(void *type_data);
};

#define LIBOBS_API_VER (((uint32_t)32u << 24) | ((uint32_t)2u << 16) | (uint32_t)2u)

typedef void (*obs_register_source_s_t)(const struct obs_source_info *info, size_t size);
typedef obs_source_t *(*obs_filter_get_parent_t)(const obs_source_t *filter);
typedef const char *(*obs_source_get_name_t)(const obs_source_t *source);

static obs_register_source_s_t p_obs_register_source_s;
static obs_filter_get_parent_t p_obs_filter_get_parent;
static obs_source_get_name_t p_obs_source_get_name;

static obs_module_t *g_module_pointer;

__declspec(dllexport) void obs_module_set_pointer(obs_module_t *module) { g_module_pointer = module; }
__declspec(dllexport) uint32_t obs_module_ver(void) { return LIBOBS_API_VER; }

typedef struct {
	obs_source_t *source;
	char source_name[256];
	volatile LONG64 count;
	uint64_t last_write_tick;
	wchar_t heartbeat_path[MAX_PATH];
} probe_filter_t;

static wchar_t heartbeat_dir[MAX_PATH];

static void write_heartbeat(probe_filter_t *f) {
	wchar_t temp_path[MAX_PATH];
	if (swprintf(temp_path, MAX_PATH, L"%ls.tmp", f->heartbeat_path) < 0) return;
	FILE *fp = _wfopen(temp_path, L"wb");
	if (!fp) return;
	LONG64 count = InterlockedCompareExchange64(&f->count, 0, 0);
	int result = fprintf(fp, "%s\t%llu\t%lld\n", f->source_name, (unsigned long long)count, (long long)time(NULL));
	int close_result = fclose(fp);
	if (result >= 0 && close_result == 0)
		MoveFileExW(temp_path, f->heartbeat_path, MOVEFILE_REPLACE_EXISTING);
}

static const char *probe_get_name(void *type_data) {
	(void)type_data;
	return "Frame Arrival Probe (Native)";
}

static void *probe_create(obs_data_t *settings, obs_source_t *source) {
	(void)settings;
	probe_filter_t *f = (probe_filter_t *)calloc(1, sizeof(probe_filter_t));
	if (!f) return NULL;
	f->source = source;
	if (swprintf(f->heartbeat_path, MAX_PATH, L"%ls\\obs-frame-heartbeat-native-%lu-%p.txt",
	             heartbeat_dir, (unsigned long)GetCurrentProcessId(), (void *)source) < 0) {
		free(f);
		return NULL;
	}
	return f;
}

static void probe_destroy(void *data) {
	probe_filter_t *f = (probe_filter_t *)data;
	if (!f) return;
	DeleteFileW(f->heartbeat_path);
	free(data);
}

static struct obs_source_frame *probe_filter_video(void *data, struct obs_source_frame *frame) {
	probe_filter_t *f = (probe_filter_t *)data;
	if (f && frame) InterlockedIncrement64(&f->count);
	return frame;
}

// OBS's render tick continues even when the capture device stops delivering frames.
// Only this callback touches source_name and writes files; the video callback increments atomically.
static void probe_video_tick(void *data, float seconds) {
	(void)seconds;
	probe_filter_t *f = (probe_filter_t *)data;
	if (!f) return;
	uint64_t now = GetTickCount64();
	if (now - f->last_write_tick < 500) return;
	obs_source_t *parent = p_obs_filter_get_parent(f->source);
	if (!parent) return;
	const char *name = p_obs_source_get_name(parent);
	if (!name || !*name || strlen(name) >= sizeof(f->source_name) || strpbrk(name, "\t\r\n")) return;
	strcpy(f->source_name, name);
	write_heartbeat(f);
	f->last_write_tick = now;
}

static struct obs_source_info probe_info = {
	.id = "frame_arrival_probe_native",
	.type = OBS_SOURCE_TYPE_FILTER,
	.output_flags = OBS_SOURCE_ASYNC_VIDEO,
	.get_name = probe_get_name,
	.create = probe_create,
	.destroy = probe_destroy,
	.video_tick = probe_video_tick,
	.filter_video = probe_filter_video,
};

__declspec(dllexport) bool obs_module_load(void) {
	DWORD length = GetEnvironmentVariableW(L"OBS_HEARTBEAT_DIR", heartbeat_dir, MAX_PATH);
	if (length >= MAX_PATH) return false;
	if (!length) {
		length = GetTempPathW(MAX_PATH, heartbeat_dir);
		if (!length || length + 13 >= MAX_PATH) return false;
		wcscat(heartbeat_dir, L"obs-watchdog");
	}
	if (wcslen(heartbeat_dir) + 80 >= MAX_PATH) return false;
	if (!CreateDirectoryW(heartbeat_dir, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) return false;
	HMODULE h = GetModuleHandleA("obs.dll");
	if (!h) return false;
	// Windows guarantees GetProcAddress results can be converted to exported function pointers.
	p_obs_register_source_s = (obs_register_source_s_t)(void *)GetProcAddress(h, "obs_register_source_s");
	p_obs_filter_get_parent = (obs_filter_get_parent_t)(void *)GetProcAddress(h, "obs_filter_get_parent");
	p_obs_source_get_name = (obs_source_get_name_t)(void *)GetProcAddress(h, "obs_source_get_name");
	if (!p_obs_register_source_s || !p_obs_filter_get_parent || !p_obs_source_get_name) return false;
	p_obs_register_source_s(&probe_info, sizeof(struct obs_source_info));
	return true;
}

__declspec(dllexport) void obs_module_unload(void) {}
