# Zenwii Windows ⚡️🎨💻
> **El santuario de escritura definitivo para creadores profesionales.**

Zenwii Windows es un editor de notas ultra-rápido, minimalista y de diseño premium, diseñado específicamente para funcionar sin distracciones. Combina la velocidad instantánea de arranque de un bloc de notas local con el poder de sincronización en tiempo real en la nube de Firebase, envuelto en una interfaz glassmorphic impresionante.

![Zenwii Logo](/src-tauri/icons/icon.png)

---

## 🚀 ¿Por qué Zenwii? (Propuesta de Valor)

* **Rendimiento Extremo**: Olvídate de pantallas de carga molestas. Gracias a la compilación nativa en Rust con Tauri y al empaquetamiento optimizado de Vite, Zenwii inicia de forma instantánea.
* **100% Offline-First con Fuentes Locales**: Hemos erradicado las dependencias de red externas. Zenwii carga de forma local e instantánea las fuentes tipográficas **Poppins** desde los archivos del sistema, permitiendo un funcionamiento perfecto sin conexión a Internet.
* **Sincronización Inteligente en Firebase**: Escribe libremente; tus notas se guardan de forma local al milisegundo y se sincronizan silenciosamente en segundo plano con tu cuenta en la nube cuando estés online.
* **Estética Ultra-Premium**: Disfruta de una interfaz viva con efectos tridimensionales fluidos, esferas flotantes interactivas, desenfoque de fondo y seis temas de autor curados al detalle:
  * 👑 **Oro** (Elegancia dorada)
  * 🌌 **Cielo** (Claridad celestial)
  * 🌸 **Dulce** (Frescura rosada)
  * 🌿 **Paz** (Naturaleza y calma)
  * 🔮 **Mora** (Misterio y creatividad)
  * 🌌 **Futuro** (Modo oscuro tecnológico avanzado)

---

## ✨ Características Premium Destacadas

### 🟢 Live Sync Status (Indicadores de Sincronización)
Cada pestaña de nota incluye un punto de estado en vivo para tu tranquilidad:
* **Gris Neutro (`#8c8c8c`)**: Cambios guardados localmente a salvo en tu computadora (pendientes de sincronizar).
* **Verde Éxito Brillante (`var(--success)` + Glow)**: Tu nota está 100% respaldada y a salvo en los servidores en la nube de Firebase.

### ⌨️ Atajos de Teclado Profesionales (Pro Shortcuts)
Agiliza tu flujo de trabajo sin levantar las manos del teclado:
* **`Ctrl + S`**: Sincroniza la nota activa en la nube inmediatamente y muestra una notificación fluida.
* **`Ctrl + N`**: Crea una nueva pestaña de nota al instante y enfoca el cursor en el título.
* **`Esc`**: Cierra el panel de formato de texto, el modal de perfil, el menú de usuario, la ventana de atajos o sale del Modo Concentración.

### 📥 Panel de Ayuda Glassmorphic de Atajos
Haz clic en el botón de **Atajos** integrado elegantemente al lado del selector de temas en la barra de estado para abrir una ventana flotante con efectos traslúcidos premium que detalla todos los comandos físicos con teclas estilizadas (`<kbd>`) y nuestro logo oficial de la pluma.

---

## 🛠️ Guía de Instalación y Desarrollo (Para Programadores)

### Requisitos Previos
Asegúrate de tener instalado en tu sistema:
1. **Node.js** (Versión 18 o superior recomendada)
2. **Rust & Tauri v2 Prerequisites** (Instalador de Rustup y compilador de C++ para Windows)
3. **pnpm** (Gestor de paquetes rápido de Node)

### Paso 1: Clonar e Instalar Dependencias
Instala los módulos del front-end utilizando el gestor `pnpm`:
```bash
# Entrar a la carpeta del proyecto de Windows
cd zenwii-windows

# Instalar dependencias locales
pnpm install
```

### Paso 2: Ejecutar en Modo Desarrollo (Hot-Reload)
Lanza el servidor de desarrollo nativo de Tauri. Esto compilará el código de Rust y habilitará la recarga en tiempo real de la UI:
```bash
pnpm tauri dev
```

### Paso 3: Compilar el Entregable de Producción (.exe)
Empaqueta y compila el instalador final optimizado para Windows:
```bash
pnpm tauri build
```
El instalador final generado (`.msi` o `.exe`) estará ubicado en:
`src-tauri/target/release/bundle/`

---

## 🔒 Arquitectura y Seguridad

Zenwii Windows cuida tus claves y tu privacidad de forma estricta. Toda la compilación nativa se ejecuta localmente y los tokens sensibles de Firebase no se exponen al historial de Git gracias a un archivo `.gitignore` robusto y bien estructurado.
