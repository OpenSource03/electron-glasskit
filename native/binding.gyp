{
  "targets": [
    {
      "target_name": "glasskit",
      "sources": ["addon.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")", "include"],
      "defines": ["NAPI_VERSION=8", "NODE_ADDON_API_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "MACOSX_DEPLOYMENT_TARGET": "12.0",
              "OTHER_LDFLAGS": [
                # The Swift half, built first by scripts/build-native.mjs.
                "-Wl,-force_load,<(module_root_dir)/.build/<(target_arch)/libGlassKitSwift.a",
                "-L<!(xcrun --show-sdk-path)/usr/lib/swift",
                "-L<!(dirname \"$(xcrun --find swiftc)\")/../lib/swift/macosx",
                "-Wl,-rpath,/usr/lib/swift"
              ]
            }
          }
        ]
      ]
    }
  ]
}
