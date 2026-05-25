// INFORMACIÓN DEL APP 
export let id = 'zenwii'
export let app = 'Zenwii'
export let icon = 'fa-feather-pointed'
export let titulo = 'Zenwii - Block de notas profesional muy facil de usar';
export let keywii = 'block de notas, gestor de tareas, productividad, notas profesionales, organización';
export let descri = 'Zenwii es tu gestor de notas profesionales para organizar tareas, ideas y proyectos. Mejora tu productividad con tablas inteligentes y gestión eficiente.';
export let linkweb = 'https://zenwii.web.app'; // Sin slash (/), al final
export let lanzamiento = 2026;
export let by = '@wilder.taype';
export let linkme = 'https://wtaype.github.io/';
export let ipdev = import.meta.env.VITE_DEV;
export let version = 'v10'; // Siempre va "v" para estructura

/** ACTUALIZAR AL TAG POR SEGURIDAD [TAG NUEVO] (1)
git tag v10 -m "Version v10" ; git push origin v10

ACTUALIZACIÓN AL MAIN PRINCIPAL DEL PROYECTO [MAIN] (2)
git add . ; git commit -m "Actualizacion Principal v10.10.10" ; git push origin main

// REEMPLAZAR TAG DE SEGURIDAD EXISTENTE [TAG REMPLAZO] (3)
git tag -d v10 ; git tag v10 -m "Version v10 actualizada" ; git push origin v10 --force

// Actualizar versiones de seguridad [ELIMINAR CARPETA - ARCHIVO ONLINE] (4)
git rm --cached skills-lock.json ; git commit -m "Archivo Eliminado" ; git push origin main
git rm -r --cached .claude/ ; git commit -m "Carpeta Eliminada" ; git push origin main 
git tag -d 10 ; git push origin --delete 10 // Eliminar tag del local y remoto.
 ACTUALIZACION TAG[END] */
