// Exercise heartbeat production without an OBS installation or capture device.
#undef NDEBUG
#include <wchar.h>
#include "frame_arrival_probe_native.c"
#include <assert.h>

static const char *test_source_name = "camera";
static obs_source_t *test_parent(const obs_source_t *source) { return (obs_source_t *)source; }
static const char *test_name(const obs_source_t *source) { (void)source; return test_source_name; }

static unsigned long long read_count(probe_filter_t *filter) {
	FILE *fp = _wfopen(filter->heartbeat_path, L"rb");
	assert(fp);
	char name[256];
	unsigned long long count;
	long long timestamp;
	assert(fscanf(fp, "%255[^\t]\t%llu\t%lld", name, &count, &timestamp) == 3);
	assert(strcmp(name, test_source_name) == 0);
	assert(timestamp > 0);
	fclose(fp);
	return count;
}

int main(void) {
	wchar_t temp[MAX_PATH];
	assert(GetTempPathW(MAX_PATH, temp));
	assert(swprintf(heartbeat_dir, MAX_PATH, L"%lswatchdog-native-test-%lu", temp, (unsigned long)GetCurrentProcessId()) > 0);
	assert(CreateDirectoryW(heartbeat_dir, NULL));
	p_obs_filter_get_parent = test_parent;
	p_obs_source_get_name = test_name;
	probe_filter_t *filter = probe_create(NULL, (obs_source_t *)(uintptr_t)1);
	assert(filter);
	assert(probe_filter_video(filter, NULL) == NULL);
	struct obs_source_frame *frame = (struct obs_source_frame *)(uintptr_t)1;
	assert(probe_filter_video(filter, frame) == frame);
	probe_video_tick(filter, 0.5f);
	assert(read_count(filter) == 1);
	// No new frames: the render tick must still replace the heartbeat file.
	assert(DeleteFileW(filter->heartbeat_path));
	filter->last_write_tick = GetTickCount64() - 501;
	probe_video_tick(filter, 0.5f);
	assert(read_count(filter) == 1);
	test_source_name = "renamed camera";
	probe_filter_video(filter, frame);
	filter->last_write_tick = GetTickCount64() - 501;
	probe_video_tick(filter, 0.5f);
	assert(read_count(filter) == 2);
	wchar_t file[MAX_PATH];
	wcscpy(file, filter->heartbeat_path);
	probe_destroy(filter);
	assert(GetFileAttributesW(file) == INVALID_FILE_ATTRIBUTES);
	assert(RemoveDirectoryW(heartbeat_dir));
	puts("Native heartbeat tests passed.");
	return 0;
}
