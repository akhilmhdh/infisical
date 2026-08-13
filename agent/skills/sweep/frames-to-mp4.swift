// Encode a PNG frame sequence to H.264 .mp4 using AVFoundation.
//
// Why this exists: Playwright's bundled ffmpeg is a stripped build with only `png` and
// `libvpx` encoders, so it cannot produce H.264, and there is no system ffmpeg here.
// macOS ships AVFoundation, which can. No new dependency, no Homebrew.
//
//   swiftc -O agent/skills/sweep/frames-to-mp4.swift -o /tmp/frames-to-mp4
//   /tmp/frames-to-mp4 <frames-dir> <out.mp4> [fps] [holdLastSeconds]
//
// Frames are taken in sorted filename order. `holdLastSeconds` repeats the final frame so
// a reader can actually read the end state instead of it flashing past.

import AVFoundation
import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: frames-to-mp4 <frames-dir> <out.mp4> [fps] [holdLastSeconds]\n".data(using: .utf8)!)
    exit(2)
}
let dir = args[1]
let outPath = args[2]
let fps = args.count > 3 ? Int32(args[3]) ?? 4 : 4
let holdLast = args.count > 4 ? Double(args[4]) ?? 2.0 : 2.0

let files = (try? FileManager.default.contentsOfDirectory(atPath: dir))?
    .filter { $0.lowercased().hasSuffix(".png") }
    .sorted() ?? []
guard !files.isEmpty else {
    FileHandle.standardError.write("no .png frames in \(dir)\n".data(using: .utf8)!)
    exit(1)
}

func cgImage(_ path: String) -> CGImage? {
    guard let data = FileManager.default.contents(atPath: path),
          let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

guard let first = cgImage("\(dir)/\(files[0])") else {
    FileHandle.standardError.write("cannot decode \(files[0])\n".data(using: .utf8)!)
    exit(1)
}
// H.264 requires even dimensions.
let w = first.width - (first.width % 2)
let h = first.height - (first.height % 2)

try? FileManager.default.removeItem(atPath: outPath)
let writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: outPath), fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: w,
    AVVideoHeightKey: h,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 2_500_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
    kCVPixelBufferWidthKey as String: w,
    kCVPixelBufferHeightKey as String: h,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func pixelBuffer(_ img: CGImage) -> CVPixelBuffer? {
    var pb: CVPixelBuffer?
    let attrs: [String: Any] = [kCVPixelBufferCGImageCompatibilityKey as String: true,
                                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
    guard CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32ARGB,
                              attrs as CFDictionary, &pb) == kCVReturnSuccess,
          let buf = pb else { return nil }
    CVPixelBufferLockBaseAddress(buf, [])
    defer { CVPixelBufferUnlockBaseAddress(buf, []) }
    guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: w, height: h,
                              bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return buf
}

// Build the frame list, repeating the final frame for the hold.
var sequence = files
let holdFrames = max(0, Int(holdLast * Double(fps)))
if holdFrames > 0, let last = files.last {
    sequence.append(contentsOf: Array(repeating: last, count: holdFrames))
}

var index: Int64 = 0
var written = 0
for name in sequence {
    guard let img = cgImage("\(dir)/\(name)"), let buf = pixelBuffer(img) else { continue }
    while !input.isReadyForMoreMediaData { usleep(5_000) }
    if adaptor.append(buf, withPresentationTime: CMTime(value: index, timescale: fps)) {
        written += 1
    }
    index += 1
}

input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()

if writer.status == .completed {
    let attrs = try? FileManager.default.attributesOfItem(atPath: outPath)
    let bytes = (attrs?[.size] as? Int) ?? 0
    let secs = Double(written) / Double(fps)
    print("wrote \(outPath)  \(w)x\(h)  \(written) frames  \(String(format: "%.1f", secs))s  \(bytes / 1024)KB")
} else {
    FileHandle.standardError.write("encode failed: \(writer.error?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
    exit(1)
}
