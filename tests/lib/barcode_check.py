"""
Lee códigos de barras/QR de una página PDF renderizada (pdftoppm + zxing-cpp).
Uso: python3 barcode_check.py archivo.pdf pagina dpi
Salida JSON: {"ok": true, "codes": [{"format": "...", "text": "..."}]} o {"ok": null, "skipped": "..."}
"""
import json, os, shutil, subprocess, sys, tempfile

def main():
    pdf, page, dpi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    try:
        import zxingcpp
        from PIL import Image
    except ImportError:
        print(json.dumps({"ok": None, "skipped": "zxing-cpp o Pillow no instalados"})); return
    if not shutil.which('pdftoppm'):
        print(json.dumps({"ok": None, "skipped": "pdftoppm no instalado"})); return
    tmp = tempfile.mkdtemp()
    base = os.path.join(tmp, 'p')
    subprocess.run(['pdftoppm', '-r', str(dpi), '-f', str(page), '-l', str(page), '-png', pdf, base], check=True)
    img = [f for f in os.listdir(tmp) if f.endswith('.png')][0]
    codes = zxingcpp.read_barcodes(Image.open(os.path.join(tmp, img)))
    print(json.dumps({"ok": True, "codes": [{"format": str(c.format), "text": c.text} for c in codes]}))

if __name__ == '__main__':
    main()
