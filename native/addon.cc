// N-API shim: converts JavaScript values and forwards to the Swift implementation.
#include <napi.h>
#include <pthread.h>

#include <string>

#include "glasskit.h"

namespace {

Napi::ThreadSafeFunction g_events;

// Takes ownership of a string returned by the Swift side.
std::string Take(char *owned) {
  if (!owned) return {};
  std::string value(owned);
  gk_free(owned);
  return value;
}

void ThrowLastError(Napi::Env env, const char *fallback) {
  std::string message = Take(gk_take_error());
  throw Napi::Error::New(env, message.empty() ? fallback : message);
}

// BrowserWindow.getNativeWindowHandle() is a Buffer holding one NSView pointer.
void *RootView(const Napi::Value &value) {
  if (!value.IsBuffer()) {
    throw Napi::TypeError::New(value.Env(), "Expected the Buffer from getNativeWindowHandle()");
  }
  auto buffer = value.As<Napi::Buffer<void *>>();
  if (buffer.ByteLength() < sizeof(void *)) {
    throw Napi::TypeError::New(value.Env(), "The window handle is too small");
  }
  return *buffer.Data();
}

std::string Text(const Napi::Value &value) { return value.As<Napi::String>().Utf8Value(); }

int32_t Id(const Napi::Value &value) { return value.As<Napi::Number>().Int32Value(); }

Napi::Value CreatedId(Napi::Env env, int32_t id) {
  if (id < 0) ThrowLastError(env, "Could not create the glass object");
  return Napi::Number::New(env, id);
}

void OnEvent(int32_t id, const char *json) {
  if (!g_events) return;
  // Queued, not called inline: events fire from AppKit's run loop, outside any JavaScript call.
  g_events.NonBlockingCall([id, payload = std::string(json)](Napi::Env env, Napi::Function listener) {
    listener.Call({Napi::Number::New(env, id), Napi::String::New(env, payload)});
  });
}

Napi::Value Capabilities(const Napi::CallbackInfo &info) {
  return Napi::String::New(info.Env(), Take(gk_capabilities()));
}

void ClearEventCallback() {
  gk_set_event_callback(nullptr);
  if (g_events) g_events.Release();
  g_events = Napi::ThreadSafeFunction();
}

void SetEventCallback(const Napi::CallbackInfo &info) {
  // Checked before the old listener is let go, so a bad argument leaves it working.
  if (!info[0].IsFunction()) throw Napi::TypeError::New(info.Env(), "Expected a function");
  ClearEventCallback();
  g_events = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "glasskit events", 0, 1);
  // Listening for events must not keep the app alive.
  g_events.Unref(info.Env());
  gk_set_event_callback(OnEvent);
}

Napi::Value BackgroundSet(const Napi::CallbackInfo &info) {
  return CreatedId(info.Env(), gk_background_set(RootView(info[0]), Text(info[1]).c_str()));
}

Napi::Value GroupCreate(const Napi::CallbackInfo &info) {
  return CreatedId(info.Env(), gk_group_create(RootView(info[0]), Text(info[1]).c_str()));
}

Napi::Value RegionCreate(const Napi::CallbackInfo &info) {
  return CreatedId(info.Env(), gk_region_create(RootView(info[0]), Id(info[1]), Text(info[2]).c_str()));
}

Napi::Value IslandCreate(const Napi::CallbackInfo &info) {
  return CreatedId(info.Env(), gk_island_create(RootView(info[0]), Text(info[1]).c_str()));
}

void ObjectUpdate(const Napi::CallbackInfo &info) {
  if (!gk_object_update(Id(info[0]), Text(info[1]).c_str())) ThrowLastError(info.Env(), "Could not update the glass object");
}

void ObjectSetFrame(const Napi::CallbackInfo &info) {
  auto number = [&](size_t index) { return info[index].As<Napi::Number>().DoubleValue(); };
  if (!gk_object_set_frame(Id(info[0]), number(1), number(2), number(3), number(4), number(5))) {
    ThrowLastError(info.Env(), "Could not move the glass object");
  }
}

void ObjectRemove(const Napi::CallbackInfo &info) { gk_object_remove(Id(info[0])); }

void IslandSetContent(const Napi::CallbackInfo &info) {
  std::string content = Text(info[1]);
  bool animated = info[2].IsString();
  std::string animation = animated ? Text(info[2]) : std::string();
  if (!gk_island_set_content(Id(info[0]), content.c_str(), animated ? animation.c_str() : nullptr)) {
    ThrowLastError(info.Env(), "Could not update the island");
  }
}

Napi::Value IslandSetValue(const Napi::CallbackInfo &info) {
  bool found = gk_island_set_value(Id(info[0]), Text(info[1]).c_str(), Text(info[2]).c_str());
  return Napi::Boolean::New(info.Env(), found);
}

Napi::Value IslandFocus(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), gk_island_focus(Id(info[0]), Text(info[1]).c_str()));
}

void HostDetach(const Napi::CallbackInfo &info) { gk_host_detach(RootView(info[0])); }

Napi::Value HostInspect(const Napi::CallbackInfo &info) {
  char *json = gk_host_inspect(RootView(info[0]));
  if (!json) return info.Env().Null();
  return Napi::String::New(info.Env(), Take(json));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // Everything here drives AppKit, which lives on the main thread; a worker thread must not get in.
  if (!pthread_main_np()) throw Napi::Error::New(env, "electron-glasskit can only be loaded on the main thread");
  env.AddCleanupHook(ClearEventCallback);
  exports.Set("capabilities", Napi::Function::New(env, Capabilities));
  exports.Set("setEventCallback", Napi::Function::New(env, SetEventCallback));
  exports.Set("backgroundSet", Napi::Function::New(env, BackgroundSet));
  exports.Set("groupCreate", Napi::Function::New(env, GroupCreate));
  exports.Set("regionCreate", Napi::Function::New(env, RegionCreate));
  exports.Set("islandCreate", Napi::Function::New(env, IslandCreate));
  exports.Set("objectUpdate", Napi::Function::New(env, ObjectUpdate));
  exports.Set("objectSetFrame", Napi::Function::New(env, ObjectSetFrame));
  exports.Set("objectRemove", Napi::Function::New(env, ObjectRemove));
  exports.Set("islandSetContent", Napi::Function::New(env, IslandSetContent));
  exports.Set("islandSetValue", Napi::Function::New(env, IslandSetValue));
  exports.Set("islandFocus", Napi::Function::New(env, IslandFocus));
  exports.Set("hostDetach", Napi::Function::New(env, HostDetach));
  exports.Set("hostInspect", Napi::Function::New(env, HostInspect));
  return exports;
}

}  // namespace

NODE_API_MODULE(glasskit, Init)
