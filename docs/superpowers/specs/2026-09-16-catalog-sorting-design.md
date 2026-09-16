# Ordenamiento del catalogo (lista y PDF)

## Problema

La lista de Catalogo y el PDF exportado siempre muestran los registros en un
solo orden fijo (mas reciente primero por fecha de registro, y dentro de cada
categoria del PDF, por titulo). No hay forma de ver el catalogo ordenado
alfabeticamente por titulo o autor, ni por año de publicacion.

## Alcance

- Aplica a las **tres** pantallas/salidas que listan el catalogo: la lista en
  pantalla (`CatalogListPage`), Aprobaciones (`ApprovalsPage` - pestañas
  Pendientes/Aprobados, que usa el mismo endpoint `/api/catalog`), y el PDF
  exportado (`exportCatalogPdf`). El mismo parametro `sort` decide las tres.
- Interfaz: un `<select>` "Ordenar por" junto a los filtros que ya existen en
  cada pantalla (categoria/estado en Catalogo; las pestañas en Aprobaciones).

## Opciones de orden

Un solo parametro `sort` (string), validado contra una lista fija de valores
permitidos - nunca un nombre de campo libre desde el cliente:

| Valor            | Campo Mongo      | Direccion | Etiqueta en el menu              |
|------------------|------------------|-----------|-----------------------------------|
| `fecha_desc`     | `createdAt`      | -1        | Fecha de registro (mas reciente) *(por defecto)* |
| `fecha_asc`      | `createdAt`      | 1         | Fecha de registro (mas antiguo)  |
| `titulo_asc`     | `titulo`         | 1         | Titulo (A-Z)                     |
| `titulo_desc`    | `titulo`         | -1        | Titulo (Z-A)                     |
| `autor_asc`      | `autor`          | 1         | Autor (A-Z)                      |
| `autor_desc`     | `autor`          | -1        | Autor (Z-A)                      |
| `anio_desc`      | `anio`           | -1        | Año (mas nuevo)                  |
| `anio_asc`       | `anio`           | 1         | Año (mas antiguo)                |

Si `sort` no viene o no es uno de estos valores, se usa `fecha_desc` (el
comportamiento actual, sin cambios para quien no toque el menu nuevo).

## Alfabetizacion real (collation)

MongoDB por defecto ordena por punto de codigo Unicode: las mayusculas van
antes que las minusculas, y los acentos no se agrupan con su letra base. Para
que "Título A-Z" ordene como espera una persona (Aguilar, García, Zamora, sin
importar mayusculas/acentos), las consultas que ordenan por `titulo` o `autor`
usan `.collation({ locale: 'es', strength: 1 })` (case-insensitive y
accent-insensitive). El orden por fecha o año no necesita collation (son
valores numericos/de fecha).

## Backend

- **`GET /api/catalog`** (`catalog_controller.js#listItems`): acepta `sort` en
  el query string, lo resuelve contra la tabla de arriba, y lo aplica en vez
  del `.sort({ createdAt: -1 })` fijo actual. Aplica `.collation(...)` solo
  cuando el campo es `titulo` o `autor`.
- **`GET /api/exports/catalog`** (`export_controller.js#exportCatalogPdf`):
  acepta el mismo `sort`, y lo combina con el agrupado por categoria que ya
  existe: `.sort({ categoria: 1, [campo]: direccion })` + collation cuando
  aplica. Las secciones por categoria (Folleto, Libro, etc.) no cambian - el
  `sort` solo decide el orden *dentro* de cada seccion.

## Frontend

- `CatalogListPage.jsx`: nuevo estado `sort` (default `'fecha_desc'`), un
  `<Select>` con las 8 opciones de la tabla de arriba, colocado junto a los
  selects de categoria/estado. Se manda como `params.sort` tanto en `cargar()`
  como en `handleExportar()`, para que la lista y el PDF exportado respeten la
  misma eleccion sin tener que configurarla dos veces.
- `ApprovalsPage.jsx`: mismo `<Select>` "Ordenar por" (mismas 8 opciones),
  junto a las pestañas Pendientes/Aprobados. Se manda como `params.sort` en su
  propio `cargar()` (usa el mismo `catalogApi.list`, sin exportar PDF aqui).
- Cambiar el orden reinicia la paginacion a la pagina 1 (mismo patron que ya
  usan categoria/estado/pestaña).

## Fuera de alcance

- No se cambia el tipo de dato de `anio` (sigue siendo `String` en el
  esquema); para años de 4 digitos el orden como texto coincide con el orden
  numerico. No se migra el esquema a `Number` en este cambio.
- No se agrega ordenamiento por columna con click en los encabezados de la
  tabla (se eligio el menu desplegable).
- No se persiste la preferencia de orden entre sesiones (vuelve a
  `fecha_desc` al recargar la pagina, igual que categoria/estado hoy).

## Pruebas

- Backend: casos en `tests/exports.test.js` y un archivo de catalogo (lista)
  que verifiquen que `sort=titulo_asc` devuelve los registros en orden
  alfabetico real (incluyendo un caso con acentos/mayusculas mezcladas), que
  un valor de `sort` invalido no rompe la peticion (cae al default), y que el
  PDF sigue agrupando por categoria con el orden interno correcto.
