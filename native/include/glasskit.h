// C interface between the N-API shim (addon.cc) and the Swift implementation.
// Every function must be called on the main thread. Options travel as UTF-8 JSON
// whose keys match the TypeScript option types.
#ifndef GLASSKIT_H_
#define GLASSKIT_H_

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Receives island events. `json` is only valid for the duration of the call.
typedef void (*gk_event_callback)(int32_t object_id, const char *json);

// Strings returned as `char *` are owned by the caller and released with gk_free.
void gk_free(char *string);

// The message for the most recent call if it failed, or NULL.
char *gk_take_error(void);

char *gk_capabilities(void);
void gk_set_event_callback(gk_event_callback callback);

// `root_view` is the NSView from BrowserWindow.getNativeWindowHandle(). It must belong to a live
// window: once the window has closed, only gk_host_detach may still be called with it.
// Creation functions return a positive id, or -1 after recording an error.
// Sets the window background, or updates the one already there. Remove it with gk_object_remove.
int32_t gk_background_set(void *root_view, const char *options_json);

int32_t gk_group_create(void *root_view, const char *options_json);
// `group_id` is 0 for a region that is not in a group.
int32_t gk_region_create(void *root_view, int32_t group_id, const char *options_json);
int32_t gk_island_create(void *root_view, const char *options_json);

// Applies the keys present in `options_json` to a background, group, region or island.
bool gk_object_update(int32_t id, const char *options_json);
// `animate_seconds` of 0 moves the object immediately.
bool gk_object_set_frame(int32_t id, double x, double y, double width, double height, double animate_seconds);
void gk_object_remove(int32_t id);

bool gk_island_set_content(int32_t id, const char *content_json, const char *animation_json);
bool gk_island_set_value(int32_t id, const char *node_id, const char *value_json);
bool gk_island_focus(int32_t id, const char *node_id);

// Removes everything this library added to the window.
void gk_host_detach(void *root_view);
// A JSON description of the glass in the window, for tests and debugging.
char *gk_host_inspect(void *root_view);

#ifdef __cplusplus
}
#endif

#endif  // GLASSKIT_H_
