# Menú lateral responsive (desplegable)

## Contexto
- App: Biblioteca USAC (React + Vite + Tailwind v4).
- Archivo afectado: `frontend/src/shared/components/Layout.jsx`.
- Problema: el `<aside>` de navegación es fijo (`w-64`), siempre visible, sin adaptarse a pantallas pequeñas. En celular esto aplasta o desborda el contenido principal, haciéndolo poco legible.

## Objetivo
- Convertir el menú lateral en algo que el usuario pueda mostrar/ocultar (toggle), funcionando tanto en PC como en celular.
- En PC, el comportamiento por defecto debe verse **exactamente igual que ahora** (nada se mueve a menos que el usuario lo oculte a propósito).
- En celular, el menú debe iniciar oculto y abrirse como un panel deslizante (overlay) sobre el contenido, no empujándolo.
- Mejorar la legibilidad y el tamaño táctil de las opciones del menú en pantallas pequeñas.
- No modificar ninguna otra pantalla de la aplicación.

## Fuera de alcance
- Tablas, formularios y demás vistas (catálogo, aprobaciones, equipo, auditoría, categorías, personal) — solo se toca el menú.
- Persistencia del estado abierto/cerrado entre recargas de página (se recalcula en cada carga según el tamaño de pantalla).
- Librerías nuevas de diálogo/drawer (Headless UI, Radix, etc.) — se implementa solo con React state + Tailwind, sin dependencias nuevas.

## Diseño

### Estado
- Un solo estado booleano `menuOpen` en `Layout.jsx`.
- Valor inicial: se calcula una vez al montar el componente con `window.matchMedia('(min-width: 768px)')` → `true` (abierto) en pantallas ≥768px, `false` (cerrado) en pantallas más chicas. 768px es el breakpoint `md` de Tailwind, ya usado como estándar en el proyecto.
- No se recalcula en `resize`, para no quitarle al usuario un estado que él mismo eligió si cambia el tamaño de la ventana a medio uso.

### Control (toggle)
- Botón con ícono (`Menu`/`X` de `lucide-react`, ya es dependencia del proyecto) ubicado junto al texto "Biblioteca USAC" en la cabecera del menú lateral.
- Cuando `menuOpen` es `false`, aparece un botón flotante fijo arriba a la izquierda de la pantalla (sobre el contenido principal) para volver a abrir el menú. Visible en cualquier tamaño de pantalla.

### Comportamiento en pantallas ≥768px (PC/tablet)
- `menuOpen = true` (default): el `<aside>` se renderiza igual que hoy — estático, dentro del flujo, `w-64`, empujando el contenido. Sin cambios visuales respecto a la versión actual.
- `menuOpen = false`: el `<aside>` no se renderiza, el `<main>` ocupa el 100% del ancho.

### Comportamiento en pantallas <768px (celular)
- `menuOpen = false` (default): el `<aside>` no se renderiza; el `<main>` ocupa toda la pantalla desde el inicio (arregla el problema actual de contenido aplastado).
- `menuOpen = true`: el `<aside>` se renderiza como panel `fixed` que se desliza desde la izquierda (`transform` + `transition`), por encima del contenido, con un fondo semitransparente (`backdrop`) detrás que:
  - al tocarlo, cierra el menú (`menuOpen = false`).
  - bloquea el scroll del `body` mientras está abierto.
- Al tocar cualquier opción de navegación (`NavLink` o enlace externo) en este modo, el menú se cierra automáticamente después de navegar.

### Legibilidad en celular
- En pantallas <768px, se aumenta levemente el tamaño de texto y el padding vertical de cada ítem del menú (área táctil más cómoda), sin afectar el tamaño en pantallas ≥768px.

## Casos borde
- Rotar el dispositivo o cambiar el tamaño de la ventana no fuerza un nuevo cálculo de `menuOpen` (ver "Estado"); ajustar esto en tiempo real quedaría como mejora futura si se necesita.
- El enlace externo "Manual del sistema (IA)" y el botón "Cerrar sesión" siguen dentro del `<aside>`, sin cambios de comportamiento.
- `CategoriesProvider` y el resto de la estructura de `Layout.jsx` no cambian.

## Pruebas antes de dar por terminado
- Levantar el frontend localmente (`npm --prefix frontend run dev`, configuración ya existente en `.claude/launch.json`).
- Verificar en ancho de escritorio: el menú se ve igual que antes del cambio; el toggle lo oculta/muestra correctamente.
- Verificar en ancho de celular (simulado): el menú inicia cerrado, el botón flotante lo abre, tocar el fondo oscuro o un link lo cierra, el contenido no se aplasta.
- Confirmar que ninguna otra pantalla cambió.

## Notas de despliegue
- Cambio únicamente en frontend, en `Layout.jsx` (y posiblemente `theme.css` si se necesita algún ajuste puntual).
- El usuario probará localmente antes de decidir desplegar; esta tarea no incluye `git push`.
