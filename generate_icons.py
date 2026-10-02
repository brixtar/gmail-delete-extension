import os
import sys

def create_icons():
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("Pillow library not found. Installing pillow first...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
        from PIL import Image, ImageDraw

    # Create directory if it doesn't exist
    os.makedirs("icons", exist_ok=True)

    sizes = [16, 48, 128]
    for size in sizes:
        # Create image with transparent background
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Draw a modern trash can icon (red/coral theme)
        # Background circle for modern look
        padding = max(1, size // 16)
        draw.ellipse([padding, padding, size - padding, size - padding], fill=(239, 68, 68, 255)) # Red-500

        # Trash can symbol (white)
        # We will scale coordinates based on size
        scale = size / 32.0
        
        # Lid
        lid_y = 10 * scale
        draw.rectangle([9 * scale, lid_y, 23 * scale, 12 * scale], fill=(255, 255, 255, 255))
        draw.rectangle([13 * scale, lid_y - 2 * scale, 19 * scale, lid_y], fill=(255, 255, 255, 255))

        # Body
        draw.rectangle([11 * scale, lid_y + 3 * scale, 21 * scale, 24 * scale], fill=(255, 255, 255, 255))
        
        # Stripes in the trash can
        draw.line([13 * scale, lid_y + 6 * scale, 13 * scale, 21 * scale], fill=(239, 68, 68, 255), width=int(max(1, scale)))
        draw.line([16 * scale, lid_y + 6 * scale, 16 * scale, 21 * scale], fill=(239, 68, 68, 255), width=int(max(1, scale)))
        draw.line([19 * scale, lid_y + 6 * scale, 19 * scale, 21 * scale], fill=(239, 68, 68, 255), width=int(max(1, scale)))

        img.save(f"icons/icon{size}.png", "PNG")
        print(f"Generated icons/icon{size}.png")

if __name__ == "__main__":
    create_icons()
