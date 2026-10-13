import Foundation

runCoreTests()
runHexColorTests()
runSVGPathTests()
runDecodingTests()
runValueStateTests()
if #available(macOS 14.0, *) {
    runRenderTests()
} else {
    print("skip  render tests need macOS 14")
}

print("\n\(Tests.passed) passed, \(Tests.failed) failed")
exit(Tests.failed == 0 ? 0 : 1)
