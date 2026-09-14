# Menú lateral responsive (desplegable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el menú lateral fijo de `Layout.jsx` en un menú que el usuario puede mostrar/ocultar, con vista en overlay en celular (para dejar de aplastar el contenido) y vista idéntica a la actual en PC por defecto.

**Architecture:** Un solo estado booleano `menuOpen` en `Layout.jsx` controla si el `<aside>` se muestra. Clases de Tailwind con el prefijo `md:` diferencian el comportamiento: en `<768px` el `<aside>` es un panel `fixed` que se desliza sobre el contenido (con backdrop); en `>=768px` es el mismo elemento estático de siempre, solo que puede ocultarse por completo (`md:hidden`) cuando el usuario lo cierra.

**Tech Stack:** React 19, react-router-dom, Tailwind v4, lucide-react (iconos `Menu`/`X`, ya son dependencia). Sin librerías nuevas.

## Global Constraints

- Solo se modifica `frontend/src/shared/components/Layout.jsx`. Ninguna otra pantalla/página cambia.
- En pantallas ≥768px, con el menú en su estado por defecto (abierto), la vista debe ser pixel-idéntica a la actual — cero cambios visuales no solicitados.
- Breakpoint de referencia: 768px, vía `window.matchMedia('(min-width: 768px)')` (constante `DESKTOP_QUERY`), igual al `md` de Tailwind.
- No agregar dependencias nuevas.
- El frontend no tiene framework de pruebas automatizado (no hay vitest/jest/testing-library instalado). La verificación de cada tarea es: `npm --prefix frontend run lint` (oxlint) + confirmar que el servidor de dev compila y la app carga sin errores de consola en `/login` (la única ruta accesible sin sesión — `Layout.jsx` se importa estáticamente desde `app/router.jsx` así que un error de sintaxis ahí rompe también `/login`). La verificación visual completa del menú (que requiere sesión iniciada) la hace el usuario localmente — el checklist exacto está en la Tarea 5.
- No hacer `git push`. Commits locales únicamente.

---

### Task 1: Estado de apertura + botones para mostrar/ocultar el menú

**Files:**
- Modify: `frontend/src/shared/components/Layout.jsx`

**Interfaces:**
- Produces: estado `menuOpen` (boolean) y setter `setMenuOpen`, y la constante `DESKTOP_QUERY = '(min-width: 768px)'` — ambos usados por las Tareas 2 y 3.

- [ ] **Step 1: Confirmar que lint está limpio antes de tocar el archivo**

Run: `npm --prefix frontend run lint`
Expected: termina sin errores (salida vacía o solo "0 problems").

- [ ] **Step 2: Agregar imports de `useState` y los íconos `Menu`/`X`**

En `frontend/src/shared/components/Layout.jsx`, reemplazar:

```jsx
import { NavLink, Outlet } from 'react-router-dom';
import {
  BookOpen,
  CheckSquare,
  ShieldCheck,
  Users,
  LogOut,
  Landmark,
  Tags,
  Activity,
  BookMarked,
  ExternalLink,
} from 'lucide-react';
```

por:

```jsx
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BookOpen,
  CheckSquare,
  ShieldCheck,
  Users,
  LogOut,
  Landmark,
  Tags,
  Activity,
  BookMarked,
  ExternalLink,
  Menu,
  X,
} from 'lucide-react';
```

- [ ] **Step 3: Agregar la constante del breakpoint**

Reemplazar:

```jsx
const MANUAL_SISTEMA_URL = 'https://claude.ai/code/artifact/c7e229c5-37bf-4a9b-93a3-fbd561e2b9eb';
```

por:

```jsx
const MANUAL_SISTEMA_URL = 'https://claude.ai/code/artifact/c7e229c5-37bf-4a9b-93a3-fbd561e2b9eb';
const DESKTOP_QUERY = '(min-width: 768px)';
```

- [ ] **Step 4: Agregar el estado `menuOpen`**

Reemplazar:

```jsx
export default function Layout() {
  const { user, logout } = useAuth();

  return (
```

por:

```jsx
export default function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);

  return (
```

- [ ] **Step 5: Backdrop, botón flotante para abrir, y clases responsive del `<aside>` + botón para cerrar**

Reemplazar:

```jsx
      <div className="flex min-h-screen">
        <aside className="flex w-64 shrink-0 flex-col bg-primary-dark text-white">
          <div className="flex items-center gap-2 px-5 py-5 text-sm font-semibold">
            <Landmark size={22} />
            <span>Biblioteca USAC</span>
          </div>
```

por:

```jsx
      <div className="flex min-h-screen">
        {menuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMenuOpen(false)}
          />
        )}
        {!menuOpen && (
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            className="fixed left-3 top-3 z-50 rounded-md bg-primary-dark p-2 text-white shadow-lg"
          >
            <Menu size={20} />
          </button>
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-primary-dark text-white transition-transform duration-200 md:static ${
            menuOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
          }`}
        >
          <div className="flex items-center justify-between gap-2 px-5 py-5 text-sm font-semibold">
            <div className="flex items-center gap-2">
              <Landmark size={22} />
              <span>Biblioteca USAC</span>
            </div>
            <button onClick={() => setMenuOpen(false)} aria-label="Cerrar menu">
              <X size={18} />
            </button>
          </div>
```

**Cómo queda funcionando:** en pantallas ≥768px, `menuOpen` inicia en `true` y el `<aside>` se ve exactamente como antes (la clase `md:static` anula el `fixed`). Si el usuario presiona la `X`, `menuOpen` pasa a `false`, se le agrega `md:hidden` y desaparece del flujo (el `<main>` ocupa el 100%). En pantallas <768px, `menuOpen` inicia en `false` (el `<aside>` está fuera de pantalla por `-translate-x-full` y además es `fixed`, así que no empuja nada); al abrirlo se desliza encima del contenido con el fondo oscuro detrás.

- [ ] **Step 6: Verificar lint**

Run: `npm --prefix frontend run lint`
Expected: sin errores nuevos.

- [ ] **Step 7: Verificar que compila y carga sin errores de consola**

Usar la herramienta de navegador: iniciar el servidor de dev del frontend (`preview_start` con `name: "frontend"`, definido en `.claude/launch.json`), navegar a `/login`, y revisar los mensajes de consola.
Expected: la página de login carga normalmente, sin errores en consola (confirma que `Layout.jsx` no tiene errores de sintaxis/importación, aunque su interfaz no sea visible sin sesión).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/shared/components/Layout.jsx
git commit -m "feat: menu lateral se puede mostrar/ocultar (toggle base)"
```

---

### Task 2: Bloquear el scroll de fondo en celular mientras el menú está abierto

**Files:**
- Modify: `frontend/src/shared/components/Layout.jsx`

**Interfaces:**
- Consumes: `menuOpen` y `DESKTOP_QUERY` de la Tarea 1.

- [ ] **Step 1: Importar `useEffect`**

Reemplazar:

```jsx
import { useState } from 'react';
```

por:

```jsx
import { useEffect, useState } from 'react';
```

- [ ] **Step 2: Agregar el efecto de bloqueo de scroll**

Reemplazar:

```jsx
  const [menuOpen, setMenuOpen] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);

  return (
```

por:

```jsx
  const [menuOpen, setMenuOpen] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);

  useEffect(() => {
    const isMobileOverlay = menuOpen && !window.matchMedia(DESKTOP_QUERY).matches;
    document.body.style.overflow = isMobileOverlay ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
```

**Por qué así:** se revisa `!matchMedia(DESKTOP_QUERY).matches` (o sea, "estamos en celular") en el momento en que `menuOpen` cambia, para bloquear el scroll SOLO cuando el panel está abierto como overlay en celular. Si solo se bloqueara con `menuOpen` a secas, se bloquearía también el scroll normal de PC (donde el menú está abierto por defecto) — eso sería un bug.

- [ ] **Step 3: Verificar lint**

Run: `npm --prefix frontend run lint`
Expected: sin errores nuevos.

- [ ] **Step 4: Verificar que compila sin errores**

Repetir el Step 7 de la Tarea 1 (recargar `/login` en la herramienta de navegador, revisar consola).
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/Layout.jsx
git commit -m "fix: bloquear scroll de fondo solo cuando el menu esta abierto en celular"
```

---

### Task 3: Cerrar el menú automáticamente al tocar una opción (solo en celular)

**Files:**
- Modify: `frontend/src/shared/components/Layout.jsx`

**Interfaces:**
- Consumes: `setMenuOpen` y `DESKTOP_QUERY` de la Tarea 1.
- Produces: función `closeOnMobileNav()`, usada en los `onClick` de los enlaces de navegación.

- [ ] **Step 1: Agregar la función `closeOnMobileNav`**

Reemplazar:

```jsx
  }, [menuOpen]);

  return (
```

por:

```jsx
  }, [menuOpen]);

  const closeOnMobileNav = () => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      setMenuOpen(false);
    }
  };

  return (
```

- [ ] **Step 2: Cerrar el menú al tocar el enlace externo ("Manual del sistema")**

Reemplazar:

```jsx
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
```

por:

```jsx
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeOnMobileNav}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
```

- [ ] **Step 3: Cerrar el menú al tocar cualquier opción interna (`NavLink`)**

Reemplazar:

```jsx
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
```

por:

```jsx
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={closeOnMobileNav}
                  className={({ isActive }) =>
```

**Por qué así:** `closeOnMobileNav` revisa el ancho de pantalla en el momento del click. En PC nunca cierra el menú (se mantiene el comportamiento actual); en celular, cierra el panel después de navegar, para no tener que cerrarlo a mano cada vez.

- [ ] **Step 4: Verificar lint**

Run: `npm --prefix frontend run lint`
Expected: sin errores nuevos.

- [ ] **Step 5: Verificar que compila sin errores**

Repetir el Step 7 de la Tarea 1.
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shared/components/Layout.jsx
git commit -m "feat: cerrar el menu al navegar, solo en celular"
```

---

### Task 4: Texto y área táctil más grandes en el menú, solo en celular

**Files:**
- Modify: `frontend/src/shared/components/Layout.jsx`

**Interfaces:**
- No agrega interfaces nuevas; solo cambia clases de Tailwind en los elementos ya existentes.

- [ ] **Step 1: Agrandar el enlace externo en celular (clases base más grandes, `md:` restaura el tamaño de PC)**

Reemplazar:

```jsx
                  onClick={closeOnMobileNav}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <item.icon size={18} />
                  <span className="flex-1">{item.label}</span>
```

por:

```jsx
                  onClick={closeOnMobileNav}
                  className="flex items-center gap-3 rounded-md px-3 py-3 text-base font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white md:py-2.5 md:text-sm"
                >
                  <item.icon size={18} />
                  <span className="flex-1">{item.label}</span>
```

- [ ] **Step 2: Agrandar los `NavLink` en celular, igual que el enlace externo**

Reemplazar:

```jsx
                  onClick={closeOnMobileNav}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
```

por:

```jsx
                  onClick={closeOnMobileNav}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-3 text-base font-medium transition-colors md:py-2.5 md:text-sm ${
                      isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
```

**Por qué así:** Tailwind es "mobile-first" — una clase sin prefijo aplica en todos los tamaños salvo que un prefijo `md:` la reemplace desde 768px hacia arriba. Poniendo `py-3 text-base` como base y `md:py-2.5 md:text-sm` para restaurar el tamaño original en PC, el cambio queda aislado a celular.

- [ ] **Step 3: Verificar lint**

Run: `npm --prefix frontend run lint`
Expected: sin errores nuevos.

- [ ] **Step 4: Verificar que compila sin errores**

Repetir el Step 7 de la Tarea 1.
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/Layout.jsx
git commit -m "style: texto y area tactil mas grandes en el menu para celular"
```

---

### Task 5: Verificación final y checklist manual para el usuario

**Files:**
- Ninguno esperado (solo verificación). Si algo falla, corregir en `frontend/src/shared/components/Layout.jsx` antes de comitear.

- [ ] **Step 1: Lint completo del frontend**

Run: `npm --prefix frontend run lint`
Expected: sin errores.

- [ ] **Step 2: Revisar el archivo final completo**

Leer `frontend/src/shared/components/Layout.jsx` de principio a fin y confirmar que:
- El resto de la estructura (`CategoriesProvider`, bloque de usuario/`Cerrar sesion`, `<main>`) no cambió respecto al original.
- Las clases `md:` están presentes en los 3 lugares clave: el `<aside>` (Tarea 1), y los dos enlaces de navegación (Tarea 4).

- [ ] **Step 3: Smoke test del servidor de dev**

Con el servidor de dev del frontend corriendo (`preview_start`, `name: "frontend"`), navegar a `/login` y confirmar en consola que no hay errores. (La vista con sesión iniciada no es alcanzable sin credenciales reales del backend; ver Step 4 para lo que el usuario debe revisar él mismo.)

- [ ] **Step 4: Checklist manual para el usuario (con sesión real, en su máquina)**

Entregar este checklist tal cual (no requiere commit, es para que el usuario lo corra):

1. Con la ventana ancha (PC): el menú se ve igual que antes de este cambio.
2. Con la ventana ancha: presionar la `X` junto a "Biblioteca USAC" — el menú se oculta y el contenido usa toda la pantalla. Presionar el botón flotante — el menú vuelve a aparecer.
3. Achicar la ventana a tamaño de celular (o abrir desde el teléfono): el menú debe iniciar cerrado y el contenido debe verse completo, sin aplastarse.
4. En celular, tocar el botón flotante: el menú se desliza desde la izquierda con un fondo oscuro detrás.
5. En celular, tocar el fondo oscuro: el menú se cierra.
6. En celular, tocar una opción del menú (por ejemplo "Catalogo"): navega Y el menú se cierra solo.
7. En celular, con el menú abierto, intentar hacer scroll en el fondo: no debe moverse la página de atrás.
8. Confirmar que ninguna otra pantalla (catálogo, aprobaciones, etc.) cambió su apariencia.

- [ ] **Step 5: Commit final (solo si el Step 2-3 encontró algo que corregir)**

```bash
git add frontend/src/shared/components/Layout.jsx
git commit -m "fix: ajustes finales del menu responsive"
```
