from PIL import Image, ImageDraw

SIZE = 64
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Halo doux
for i in range(14, 0, -1):
    alpha = int(9 * (15 - i))
    r = 30 - i // 2
    d.ellipse((SIZE / 2 - r, SIZE / 2 - r, SIZE / 2 + r, SIZE / 2 + r), fill=(54, 82, 217, alpha))

# Épaules
d.rounded_rectangle((14, 38, 50, 62), radius=12, fill=(54, 82, 217, 255), outline=(255, 255, 255, 235), width=3)
# Tête
d.ellipse((20, 10, 44, 38), fill=(230, 234, 240, 255), outline=(255, 255, 255, 235), width=3)
# Mèche de cheveux
d.chord((19, 8, 45, 34), 180, 360, fill=(27, 34, 48, 255))
# Yeux
d.ellipse((26, 25, 30, 29), fill=(27, 34, 48, 255))
d.ellipse((34, 25, 38, 29), fill=(27, 34, 48, 255))

img.save(r"D:\sarraclaud\desktop\assets\tray.png")
print("ok")
