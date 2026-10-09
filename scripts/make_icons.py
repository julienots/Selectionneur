"""Génère les icônes du jeu (PWA + lanceur Android) à partir de zéro, sans image source.
Usage : python3 scripts/make_icons.py   (à relancer seulement si on veut changer le logo)"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

S = 1024

def background(size):
    img = Image.new("RGB", (size, size), (5, 9, 20))
    px = img.load()
    cx, cy = size/2, size*0.38
    for y in range(size):
        for x in range(size):
            d = math.hypot(x-cx, y-cy)/(size*0.75)
            t = max(0.0, 1-d)
            px[x, y] = (int(5+28*t*t), int(9+40*t*t), int(20+90*t*t))
    return img

def foreground(size, scale=1.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size/2
    k = size/1024*scale
    # pelouse en perspective
    pw, ph = 760*k, 300*k
    py = c + 150*k
    d.ellipse([c-pw/2, py-ph/2, c+pw/2, py+ph/2], fill=(34, 110, 48, 255))
    d.ellipse([c-pw/2+18*k, py-ph/2+10*k, c+pw/2-18*k, py+ph/2-10*k], outline=(235, 245, 235, 255), width=max(2, int(7*k)))
    d.line([c, py-ph/2+10*k, c, py+ph/2-10*k], fill=(235, 245, 235, 255), width=max(2, int(7*k)))
    d.ellipse([c-90*k, py-34*k, c+90*k, py+34*k], outline=(235, 245, 235, 255), width=max(2, int(7*k)))
    # halo doré
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = 250*k
    by = c - 40*k
    gd.ellipse([c-r-40*k, by-r-40*k, c+r+40*k, by+r+40*k], fill=(212, 175, 55, 150))
    glow = glow.filter(ImageFilter.GaussianBlur(40*k))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    # ballon
    d.ellipse([c-r, by-r, c+r, by+r], fill=(246, 246, 246, 255), outline=(212, 175, 55, 255), width=max(3, int(16*k)))
    def pent(x, y, rr, rot=-math.pi/2):
        pts = [(x+math.cos(rot+i*2*math.pi/5)*rr, y+math.sin(rot+i*2*math.pi/5)*rr) for i in range(5)]
        d.polygon(pts, fill=(20, 20, 24, 255))
        return pts
    centre = pent(c, by, 78*k)
    for i in range(5):
        a = -math.pi/2 + i*2*math.pi/5
        x, y = c+math.cos(a)*200*k, by+math.sin(a)*200*k
        pent(x, y, 62*k, a+math.pi/2+math.pi)
        d.line([centre[i], (c+math.cos(a)*140*k, by+math.sin(a)*140*k)], fill=(40, 40, 46, 255), width=max(2, int(8*k)))
    # masque circulaire pour couper les pentagones extérieurs au ballon
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([c-r+8*k, by-r+8*k, c+r-8*k, by+r-8*k], fill=255)
    ball = img.copy()
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base = Image.alpha_composite(base, glow)
    d2 = ImageDraw.Draw(base)
    d2.ellipse([c-pw/2, py-ph/2, c+pw/2, py+ph/2], fill=(34, 110, 48, 255))
    d2.ellipse([c-pw/2+18*k, py-ph/2+10*k, c+pw/2-18*k, py+ph/2-10*k], outline=(235, 245, 235, 255), width=max(2, int(7*k)))
    d2.line([c, py-ph/2+10*k, c, py+ph/2-10*k], fill=(235, 245, 235, 255), width=max(2, int(7*k)))
    d2.ellipse([c-90*k, py-34*k, c+90*k, py+34*k], outline=(235, 245, 235, 255), width=max(2, int(7*k)))
    d2.ellipse([c-r, by-r, c+r, by+r], fill=(212, 175, 55, 255))
    base.paste(ball, (0, 0), mask)
    return base

def full_icon(size, round_=False):
    bg = background(256).resize((size, size), Image.LANCZOS).convert("RGBA")
    fg = foreground(1024, 0.92).resize((size, size), Image.LANCZOS)
    out = Image.alpha_composite(bg, fg)
    if round_:
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).ellipse([0, 0, size-1, size-1], fill=255)
        r = Image.new("RGBA", (size, size), (0, 0, 0, 0)); r.paste(out, (0, 0), m); out = r
    return out

if __name__ == "__main__":
    os.makedirs("www/icons", exist_ok=True)
    full_icon(512).save("www/icons/icon-512.png")
    full_icon(192).save("www/icons/icon-192.png")
    res = "android/app/src/main/res"
    if os.path.isdir(res):
        dens = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
        fg_big = foreground(1024, 0.62)  # zone sûre des icônes adaptatives (66 %)
        for dn, sz in dens.items():
            d = f"{res}/mipmap-{dn}"
            os.makedirs(d, exist_ok=True)
            full_icon(sz).save(f"{d}/ic_launcher.png")
            full_icon(sz, True).save(f"{d}/ic_launcher_round.png")
            fsz = int(sz*108/48)
            fg_big.resize((fsz, fsz), Image.LANCZOS).save(f"{d}/ic_launcher_foreground.png")
        print("icônes Android OK")
    print("icônes web OK")

def splash(w, h):
    bg = background(256).resize((max(w, h), max(w, h)), Image.LANCZOS).crop((0, 0, w, h)).convert("RGBA")
    s = int(min(w, h)*0.42)
    fg = foreground(1024, 1.0).resize((s, s), Image.LANCZOS)
    bg.alpha_composite(fg, ((w-s)//2, (h-s)//2 - int(h*0.03)))
    return bg.convert("RGB")

if __name__ == "__main__":
    import glob
    for f in glob.glob("android/app/src/main/res/drawable*/splash.png"):
        w, h = Image.open(f).size
        # v43 : écran natif NOIR (enchaîne sur le logo SuperEssence affiché par le jeu)
        Image.new("RGB", (w, h), (0, 0, 0)).save(f)
    print("écrans de démarrage OK")
