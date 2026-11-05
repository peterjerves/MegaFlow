"""
Verificación independiente de fórmulas del Excel de control con LibreOffice.

1. openpyxl abre el XLSX generado por MegaFlow y lo vuelve a guardar SIN los valores
   en caché (openpyxl solo conserva el texto de las fórmulas).
2. LibreOffice (headless) abre esa copia, RECALCULA y exporta a CSV.
3. Se compara la columna H calculada con el texto esperado y se buscan errores (#NAME?, #REF!, #VALUE!).

Uso: python3 recalc_check.py control.xlsx expected.json
Salida: JSON con {ok, rows, errors}
"""
import csv, json, os, shutil, subprocess, sys, tempfile

def main():
    src, expected_path = sys.argv[1], sys.argv[2]
    expected = json.load(open(expected_path, encoding='utf-8'))
    try:
        import openpyxl
    except ImportError:
        print(json.dumps({"ok": None, "skipped": "openpyxl no instalado"})); return
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    if not soffice:
        print(json.dumps({"ok": None, "skipped": "LibreOffice no instalado"})); return
    tmp = tempfile.mkdtemp()
    wb = openpyxl.load_workbook(src)  # fórmulas como texto, sin valores en caché
    ws = wb['PedidosCoral']
    formulas = [ws.cell(row=r, column=8).value for r in range(2, ws.max_row + 1)]
    tables = list(ws.tables.keys())
    nocache = os.path.join(tmp, 'sin_cache.xlsx')
    wb.save(nocache)
    env = dict(os.environ, HOME=tmp)
    subprocess.run([soffice, '--headless', '--norestore', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1', '--outdir', tmp, nocache],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, timeout=120)
    rows = list(csv.reader(open(os.path.join(tmp, 'sin_cache.csv'), encoding='utf-8', newline='')))
    errors = []
    header = rows[0]
    if header != expected['header']:
        errors.append(f"Encabezado distinto: {header}")
    data = rows[1:]
    if len(data) != len(expected['detail']):
        errors.append(f"Filas: {len(data)} (esperadas {len(expected['detail'])})")
    for i, (row, exp) in enumerate(zip(data, expected['detail'])):
        h = row[7] if len(row) > 7 else ''
        if any(tok in ''.join(row) for tok in ('#NAME', '#REF', '#VALUE', 'Err:')):
            errors.append(f"Fila {i + 2}: error de fórmula {row}")
        if h != exp:
            errors.append(f"Fila {i + 2}: H calculado {h!r} != esperado {exp!r}")
    for i, f in enumerate(formulas):
        want = f'=_xlfn.CONCAT(A{i + 2},CHAR(10),"SAP: ",B{i + 2},CHAR(10),"OC: ",C{i + 2})'
        if f != want:
            errors.append(f"H{i + 2}: fórmula {f!r}")
    print(json.dumps({"ok": not errors, "rows": len(data), "tables": tables, "errors": errors[:20], "sampleH2": data[0][7] if data else None}, ensure_ascii=False))

if __name__ == '__main__':
    main()
