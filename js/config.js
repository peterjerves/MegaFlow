/**
 * MegaFlow — Configuración central.
 *
 * ESTE ES EL ÚNICO LUGAR donde se definen empresa, cliente, parámetros de Odoo,
 * catálogo de productos, reglas de vencimiento y nombres de archivo.
 * El resto de módulos leen estos valores; no los dupliques en otros archivos.
 *
 * Para cambiar un valor: edita este archivo, súbelo a GitHub y recarga la página
 * con Ctrl+Shift+R (Windows) o Cmd+Shift+R (Mac).
 */

export const CONFIG = Object.freeze({
  app: {
    name: 'MegaFlow',
    subtitle: 'Automatización documental',
    version: '3.3.0',
  },

  company: {
    name: 'Mega Suministros SAS',
    legalName: 'MEGASUMINISTROS S.A.S.',
    ruc: '0195168598001',
    country: 'Ecuador',
  },

  /** Cliente predeterminado (Gerardo Ortiz e Hijos / Coral). */
  customer: {
    odooName: 'Gerardo Ortiz e Hijos Cia. Ltda.',
    ruc: '0190072002001',
  },

  /** Parámetros comprobados mediante importaciones reales en Odoo Online 19.3 Enterprise. */
  odoo: {
    journal: 'Ventas 001-001',
    incomeAccount: '410101 Venta de bienes',
    /** ID interno (Database ID) del impuesto "IVA 15% (411, B)". Cambiar si se usa otra base de datos Odoo. */
    taxDatabaseId: 5,
    taxLabel: 'IVA 15% (411, B)',
    /** Nombre del plazo de pago en Odoo. Vacío = Odoo usa la columna Due Date. */
    paymentTerms: '',
    sheetName: 'Customer Invoices & Credit Note',
    /** Columnas del importador, en este orden exacto (formato ya probado). */
    columns: [
      'Partner',
      'Invoice Bill Date',
      'Due Date',
      'Payment Terms',
      'Journal*',
      'Invoice Lines/Product',
      'Invoice Lines/Account*',
      'Invoice Lines/Quantity',
      'Invoice Lines/Unit Price',
      'Invoice Lines/Taxes/Database ID',
      'Reference',
      'Invoice Lines/Label',
      'Invoice Lines/Display Type',
    ],
    displayTypeProduct: 'product',
    displayTypeNote: 'line_note',
    /** Plantilla de la referencia de cada factura. */
    referenceTemplate: 'OC {oc} / SAP {sap}',
  },

  tax: {
    /** IVA en porcentaje entero (15 = 15 %). */
    ivaPercent: 15,
  },

  /**
   * Catálogo de productos que YA EXISTEN en Odoo. No se crean productos nuevos.
   * - ean: código de barras (Cod.Prov en la orden Coral, Código Principal en la factura).
   * - coralCode: código interno Coral (columna Cod.GO), sin el sufijo "-UN".
   * - size: talla, usada en el Excel de control.
   * - odooName: nombre EXACTO del producto en Odoo.
   * - price: precio unitario sin IVA (USD). Se compara contra cada orden; nunca se modifica.
   */
  products: [
    { size: 'M',  ean: '0799192905988', coralCode: 'XGN0200', odooName: 'Lucky Pet Pad Entrenamiento Mascotas Talla M Pack 10', price: 2.00 },
    { size: 'L',  ean: '0799192905995', coralCode: 'XGN0201', odooName: 'Lucky Pet Pad Entrenamiento Mascotas Talla L Pack 10', price: 2.25 },
    { size: 'XL', ean: '0799192906008', coralCode: 'XGN0202', odooName: 'Lucky Pet Pad Entrenamiento Mascotas Talla XL Pack 5',  price: 2.58 },
  ],

  /** Tallas en el orden de las columnas del Excel de control. */
  sizes: ['M', 'L', 'XL'],

  /** Reglas de vencimiento. */
  dueDate: {
    /** 'days90' = 90 días calendario exactos | 'months3' = tres meses calendario | 'manual'. */
    defaultMode: 'months3',
    modes: [
      { id: 'months3', label: 'Tres meses calendario', months: 3 },
      { id: 'days90', label: '90 días calendario exactos', days: 90 },
      { id: 'manual', label: 'Fecha de vencimiento manual' },
    ],
  },

  /** Identificadores: formatos esperados (se usan para validar, no para adivinar). */
  identifiers: {
    sap: /^[A-Z]{2}\d{5,7}$/,
    oc: /^\d{10}$/,
    invoice: /^\d{3}-\d{3}-\d{9}$/,
  },

  /**
   * Nombre de tienda: Coral recorta la cabecera. Si el texto tras "/" es un prefijo
   * de UNA sola palabra de la dirección del documento, se completa (ej. "QU" → "QUITO").
   * Si no hay confirmación inequívoca en la dirección, se deja tal cual.
   * Estas palabras se consideran completas y nunca se expanden.
   */
  store: {
    completeLocationWords: ['QUITO', 'GUAYAQUIL', 'CUENCA', 'GUAYAS', 'AMBATO', 'MANTA', 'SAMBORONDON', 'MACHALA', 'LOJA', 'PORTOVIEJO', 'RIOBAMBA', 'IBARRA', 'TUMBACO', 'SANTO DOMINGO', 'ESMERALDAS', 'BABAHOYO', 'MILAGRO', 'LATACUNGA', 'AZOGUES'],
  },

  /** Nombres de archivo. {fecha} = fecha de envío de las órdenes (AAAA_MM_DD). */
  fileNames: {
    odoo: 'facturas_odoo_coral_{fecha}.xlsx',
    control: 'pedidos_coral_{fecha}.xlsx',
    /** {dia}_{mes} = 30_octubre · {formato} = A4 (2 páginas por hoja) o A5 */
    dossier: 'expedientes_coral_{dia}_{mes}_{formato}.pdf',
  },

  /** Excel de control. */
  controlExcel: {
    sheetName: 'PedidosCoral',
    tableName: 'PedidosCoral',
    columns: ['Nombre tienda', 'Número de orden', 'Pedido compra', 'Talla M', 'Talla L', 'Talla XL', 'Valor orden (USD)', 'Detalle pedido'],
    headerColor: 'FF1E3A5F', // azul oscuro
  },

  /**
   * Expediente PDF. Cada pedido tiene 4 páginas lógicas: factura, copia, orden, prevalidación.
   * Formatos de salida (medidas en puntos PDF, 1 pt = 1/72 pulgada):
   *  - 'a4-2up': A4 horizontal (297 × 210 mm) con DOS páginas lado a lado (izquierda | derecha)
   *              para imprimir en A4 y cortar por la mitad. Hoja 1 = factura | copia,
   *              hoja 2 = orden | prevalidación.
   *  - 'a5':     A5 vertical (148 × 210 mm), una página por hoja.
   */
  dossier: {
    pagesPerOrder: 4,
    defaultSort: 'orders', // 'orders' | 'sap' | 'invoice'
    defaultLayout: 'a4-2up',
    /** Línea de corte punteada al centro de cada hoja A4 (se puede desactivar en pantalla). */
    cutLine: true,
    layouts: {
      'a4-2up': { label: 'A4 horizontal · 2 páginas por hoja (para cortar)', sheetWidth: 841.89, sheetHeight: 595.276, slots: 2, fileTag: 'A4' },
      a5: { label: 'A5 vertical · 1 página por hoja', sheetWidth: 419.528, sheetHeight: 595.276, slots: 1, fileTag: 'A5' },
    },
  },

  limits: {
    /** Tamaño máximo por archivo PDF. */
    maxFileSizeMB: 150,
    /** Mínimo de caracteres para considerar que una página tiene texto seleccionable. */
    minTextChars: 20,
  },

  /** Rutas relativas (compatibles con GitHub Pages en subcarpeta). */
  vendor: {
    pdfjs: '../vendor/pdfjs/pdf.min.js',
    /** Envoltorio local que añade compatibilidad con Safari y carga vendor/pdfjs/pdf.worker.min.js. */
    pdfjsWorker: './pdf-worker.js',
    pdfjsStandardFonts: '../vendor/pdfjs/standard_fonts/',
    pdfLib: '../vendor/pdf-lib/pdf-lib.min.js',
    exceljs: '../vendor/exceljs/exceljs.min.js',
  },

  /** Única preferencia guardada en el navegador: el tema visual. Nunca documentos. */
  themeStorageKey: 'megaflow-theme',
});

/** Índices de catálogo derivados (no editar). */
export const CATALOG = Object.freeze({
  byEan: new Map(CONFIG.products.map((p) => [p.ean, p])),
  byCoralCode: new Map(CONFIG.products.map((p) => [p.coralCode, p])),
  bySize: new Map(CONFIG.products.map((p) => [p.size, p])),
});

export const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
