# Examples:
#   python generate_icons.py --output-dir ./icons
#   python generate_icons.py --output-dir ./icons --debug
#   python generate_icons.py --help

import argparse
import os
import struct
import zlib

def create_png_data(width, height, color_rgb):
    """
    Generate valid raw PNG bytes without external dependencies.
    Uses pure Python struct and zlib.
    """
    r, g, b = color_rgb
    raw_rows = bytearray()
    
    # Simple icon with a colored rounded box and inner accent
    for y in range(height):
        raw_rows.append(0)  # Filter byte per row
        for x in range(width):
            # Distance from center
            cx = (x - width / 2.0) / (width / 2.0)
            cy = (y - height / 2.0) / (height / 2.0)
            dist_sq = cx * cx + cy * cy
            
            if dist_sq <= 0.85:
                # Inside circle/shield: indigo theme with subtle gradient
                dr = int(max(0, min(255, r + int(cy * 25))))
                dg = int(max(0, min(255, g + int(cy * 25))))
                db = int(max(0, min(255, b + int(cy * 25))))
                raw_rows.extend([dr, dg, db, 255])
            elif dist_sq <= 0.98:
                # Border
                raw_rows.extend([255, 255, 255, 220])
            else:
                # Transparent outside
                raw_rows.extend([0, 0, 0, 0])

    compressed_data = zlib.compress(bytes(raw_rows))

    def make_chunk(chunk_type, chunk_data):
        chunk_len = len(chunk_data)
        crc = zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        return struct.pack(">I", chunk_len) + chunk_type + chunk_data + struct.pack(">I", crc)

    # PNG Signature
    png = b"\x89PNG\r\n\x1a\n"
    # IHDR chunk: width, height, 8 bit depth, RGBA (6), compression 0, filter 0, interlace 0
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png += make_chunk(b"IHDR", ihdr_data)
    # IDAT chunk
    png += make_chunk(b"IDAT", compressed_data)
    # IEND chunk
    png += make_chunk(b"IEND", b"")

    return png

def build_parser():
    parser = argparse.ArgumentParser(
        description="Generate standard PNG icons for SwissKnife Chrome extension.",
        epilog="Examples:\n  python generate_icons.py --output-dir ./icons\n  python generate_icons.py --output-dir ./icons --debug\n",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--output-dir",
        default="./icons",
        help="Target folder where icon files will be written (default: ./icons)"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable verbose debug logging during generation"
    )
    return parser

def run_icon_generation(args):
    target_dir = os.path.abspath(args.output_dir)
    os.makedirs(target_dir, exist_ok=True)
    
    sizes = [16, 32, 48, 128]
    # Primary theme color: Slate Blue (79, 70, 229)
    color = (79, 70, 229)

    if args.debug:
        print(f"[DEBUG] Target output directory: {target_dir}")
        print(f"[DEBUG] Primary RGB color: {color}")

    for size in sizes:
        file_name = f"icon{size}.png"
        file_path = os.path.join(target_dir, file_name)
        data = create_png_data(size, size, color)
        with open(file_path, "wb") as f:
            f.write(data)
        if args.debug:
            print(f"[DEBUG] Generated {file_path} ({len(data)} bytes)")
        else:
            print(f"Generated {file_name}")

def main():
    parser = build_parser()
    args = parser.parse_args()
    run_icon_generation(args)

if __name__ == "__main__":
    main()
