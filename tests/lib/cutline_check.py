"""
Mide la línea de corte central de una hoja A4 horizontal del PDF final.
Uso: python3 cutline_check.py archivo.pdf pagina
Salida JSON: {"ok": true, "coverage": 0.55}  (fracción de la altura con trazo gris en el centro)
"""
import json, os, shutil, subprocess, sys, tempfile

def main():
    pdf, page = sys.argv[1], int(sys.argv[2])
    try:
        from PIL import Image
    except ImportError:
        print(json.dumps({"ok": None, "skipped": "Pillow no instalado"})); return
    if not shutil.which('pdftoppm'):
        print(json.dumps({"ok": None, "skipped": "pdftoppm no instalado"})); return
    tmp = tempfile.mkdtemp()
    subprocess.run(['pdftoppm', '-r', '200', '-f', str(page), '-l', str(page), '-png', pdf, os.path.join(tmp, 'p')], check=True)
    im = Image.open(os.path.join(tmp, [f for f in os.listdir(tmp) if f.endswith('.png')][0])).convert('RGB')
    w, h = im.size
    cx = w // 2
    hits = 0
    for y in range(h):
        found = False
        for x in range(cx - 2, cx + 3):
            r, g, b = im.getpixel((x, y))
            if max(r, g, b) < 225 and max(r, g, b) - min(r, g, b) < 14:
                found = True
                break
        hits += found
    print(json.dumps({"ok": True, "coverage": round(hits / h, 3), "size": [w, h]}))

if __name__ == '__main__':
    main()
