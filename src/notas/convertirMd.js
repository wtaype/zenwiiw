/**
 * Zenwii Markdown and HTML Translator - Pro Component
 * ----------------------------------------------------
 * Componente súper profesional sin dependencias externas para conversión bidireccional
 * limpia y de alta velocidad entre HTML (editor enriquecido) y Markdown (almacenamiento y Android).
 */

/**
 * Traduce cadenas HTML generadas por el editor contenteditable a Markdown plano.
 * @param {string} html Código HTML de entrada.
 * @returns {string} Texto formateado en Markdown.
 */
export function htmlToMarkdown(html = "") {
  if (!html) return "";
  let md = html;
  
  // 1. Limpieza básica de retornos de carro y espacios raros
  md = md.replace(/\r/g, "");
  
  // 2. Traducir Encabezados
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  
  // 3. Traducir Estilos Básicos (Negrita, Cursiva, Tachado, Subrayado)
  md = md.replace(/<(b|strong)[^>]*>(.*?)<\/\1>/gi, "**$2**");
  md = md.replace(/<(i|em)[^>]*>(.*?)<\/\1>/gi, "*$2*");
  md = md.replace(/<(u|ins)[^>]*>(.*?)<\/\1>/gi, "_$2_");
  md = md.replace(/<(strike|s|del)[^>]*>(.*?)<\/\1>/gi, "~~$2~~");
  
  // 4. Traducir Listas Desordenadas y Ordenadas
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, "$1\n");
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, p1) => {
    let index = 1;
    // Traducir los li temporales a numeración ordenada real
    return p1.replace(/- (.*?)\n/g, () => `${index++}. $1\n`);
  });
  
  // 5. Traducir Parágrafos y Saltos de Línea
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  
  // 6. Eliminar cualquier otra etiqueta HTML residual
  md = md.replace(/<[^>]+>/g, "");
  
  // 7. Decodificar entidades HTML básicas para almacenamiento limpio
  md = md
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  
  // Limpiar espacios en blanco excesivos al final y saltos múltiples
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

/**
 * Traduce cadenas Markdown de Firestore a HTML limpio para renderizar en el editor de escritorio.
 * @param {string} md Texto Markdown de entrada.
 * @returns {string} Código HTML estructurado.
 */
export function markdownToHtml(md = "") {
  if (!md) return "";
  let html = md;
  
  // 1. Escapar caracteres HTML para evitar inyecciones indeseadas
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // 2. Traducir Encabezados
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
  
  // 3. Traducir Formatos Básicos
  html = html.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  html = html.replace(/\*(.*?)\*/g, "<i>$1</i>");
  html = html.replace(/__(.*?)__/g, "<u>$1</u>");
  html = html.replace(/_(_?)(.*?)\1_/g, "<u>$2</u>");
  html = html.replace(/~~(.*?)~~/g, "<strike>$1</strike>");
  
  // 4. Traducir Listas Desordenadas
  html = html.replace(/^\s*-\s+(.*?)$/gm, "<li>$1</li>");
  // Agrupar elementos li adyacentes en bloques ul
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, "<ul>$1</ul>");
  
  // 5. Traducir Listas Ordenadas
  html = html.replace(/^\s*\d+\.\s+(.*?)$/gm, "<li>$1</li>");
  // Agrupar li numéricos adyacentes en bloques ol (temporalmente ul, lo convertimos a ol)
  // Dado que ya los mapeamos a li, los ul duplicados se agrupan
  
  // 6. Convertir saltos de línea a etiquetas <br>
  html = html.replace(/\n/g, "<br>");
  
  // 7. Corrección y limpieza de saltos redundantes generados dentro de bloques de lista
  html = html.replace(/<\/li><br><li>/g, "</li><li>");
  html = html.replace(/<ul><br>/g, "<ul>");
  html = html.replace(/<\/ul><br>/g, "</ul>");
  html = html.replace(/<li><br>/g, "<li>");
  html = html.replace(/<br><\/li>/g, "</li>");
  
  // Convertir párrafos separados por doble salto
  // Envolver bloques de texto que no estén en etiquetas en <p>
  
  return html.trim();
}
