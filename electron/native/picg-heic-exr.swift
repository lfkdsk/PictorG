// picg-heic-exr — decode a HEIC into a linear-float OpenEXR (HDR) via macOS
// Core Image. First half of PicG's Ultra HDR JPEG pipeline.
//
// Why this split exists: Core Image is the only thing that can read a HEIC's
// HDR (via `.expandToHDR`, which understands BOTH Apple and ISO 21496-1 gain
// maps); but macOS CANNOT write a browser-renderable gain-map image (its
// gain-map JPEG/AVIF output is Apple-format, which Chrome/Safari don't honor
// — verified). hdrify (JS) CAN write a browser-honored Ultra HDR JPEG, but
// only reads EXR/HDR, not HEIC. So we hand off via EXR: this tool does
// HEIC → EXR, hdrify does EXR → Ultra HDR JPEG (SDR base + gain map).
//
// Usage: picg-heic-exr <in> <out.exr> [--max-megapixels N]
// Prints "exr <w>x<h>" on success; non-zero + stderr on failure (caller
// falls back to the sharp SDR path).

import Foundation
import CoreImage
import CoreGraphics

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    fail("usage: picg-heic-exr <in> <out.exr> [--max-megapixels N]")
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

var maxMegapixels: Double? = nil
var idx = 3
while idx < args.count {
    if args[idx] == "--max-megapixels", idx + 1 < args.count, let m = Double(args[idx + 1]), m > 0 {
        maxMegapixels = m
        idx += 1
    }
    idx += 1
}

// .expandToHDR builds an HDR CIImage by combining the primary image with its
// gain map — works for Apple gain maps AND ISO 21496-1. .applyOrientationProperty
// bakes EXIF orientation into the pixels (EXR carries no orientation tag).
guard let hdr = CIImage(
    contentsOf: inURL,
    options: [.expandToHDR: true, .applyOrientationProperty: true]
) else {
    fail("cannot decode source as HDR")
}

// Honour the megapixel cap in the linear HDR domain before export — an EXR of
// a 100 MP source is enormous (~4 bytes × 4 channels × pixels) and pointless
// for a web gallery; downscaling here keeps the handoff to hdrify light.
let ext = hdr.extent
var image = hdr
if let mp = maxMegapixels, ext.width > 0, ext.height > 0 {
    let cap = mp * 1_000_000
    let area = Double(ext.width) * Double(ext.height)
    if area > cap {
        let scale = CGFloat((cap / area).squareRoot())
        image = hdr.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }
}

let ctx = CIContext(options: [.cacheIntermediates: false])
do {
    try ctx.writeOpenEXRRepresentation(of: image, to: outURL, options: [:])
    print("exr \(Int(image.extent.width))x\(Int(image.extent.height))")
} catch {
    fail("EXR write failed: \(error)")
}
