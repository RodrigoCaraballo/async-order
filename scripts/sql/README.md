# Esquema inicial de PostgreSQL

`001-create-schema.sql` está basado en `docs/system-design.md`, no en las
entidades TypeORM. Crea `accounts`, `orders`, la FK, la clave de idempotencia
única y el índice parcial de una orden activa por usuario.

## Ejecutar en local

Desde la raíz del repositorio, con la configuración actual de `compose.yaml`:

```powershell
docker compose up -d --wait postgres
docker compose cp ./scripts/sql/001-create-schema.sql postgres:/tmp/001-create-schema.sql
docker compose exec -T postgres psql -U async_order -d async_order -v ON_ERROR_STOP=1 -f /tmp/001-create-schema.sql
```

Estos comandos funcionan también en Bash y no requieren instalar `psql` en el
host. El script no se ejecuta automáticamente al arrancar Docker o Nest.

Para inspeccionar el resultado:

```powershell
docker compose exec -T postgres psql -U async_order -d async_order -c '\d accounts'
docker compose exec -T postgres psql -U async_order -d async_order -c '\d orders'
```

## Decisiones y límites

- Se conserva `VARCHAR` para estados y pasos, como en el SQL del documento;
  los `CHECK` restringen sus valores y exigen que el prefijo del paso coincida
  con el estado.
- `accounts` no tiene columna `version`. El débito sigue siendo un UPDATE
  condicional atómico sobre el saldo.
- Los UUID los suministra la aplicación. `created_at` y `updated_at` tienen
  `DEFAULT now()` en ambas tablas: PostgreSQL proporciona la fecha al insertar
  si se omite la columna. Los valores explícitos de la aplicación prevalecen.
- No hay trigger para actualizar `updated_at`. TypeORM lo gestiona mediante
  `@UpdateDateColumn` en sus operaciones de actualización; el SQL directo debe
  establecer `updated_at = now()` explícitamente.
- Los checks validan el estado actual, no la transición desde el anterior.
  La aplicación sigue siendo responsable de las transiciones, la autorización,
  la atomicidad entre débito y checkpoint y la idempotencia del pago externo.
- Es un script inicial, no una migración incremental ni un script idempotente.
  Si las tablas ya existen, falla sin borrarlas. La transacción y
  `ON_ERROR_STOP=1` evitan dejar el esquema parcialmente creado.
- Mantén las entidades alineadas con este esquema y `synchronize: false`.
  `SchemaValidator` bloquea el arranque si TypeORM propone cambios; no los ejecuta.

## Añadir defaults a una base existente

No vuelvas a ejecutar el script inicial sobre tablas existentes. Para añadir
los defaults sin cambiar las fechas de registros existentes:

```sql
BEGIN;
ALTER TABLE public.accounts
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.orders
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
COMMIT;
```
