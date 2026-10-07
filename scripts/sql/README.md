# Esquema y actualizaciones de PostgreSQL

`001-create-schema.sql` crea `accounts`, `orders`, la FK, los checks de estados
y pasos, y un índice único parcial alineado con las entidades TypeORM:

- `unique_active_order_idempotency_key`: único por `idempotency_key`.

El índice aplica solamente a `status IN ('PENDING', 'PROCESSING')`. La clave de
idempotencia puede repetirse entre órdenes terminadas. El diseño está documentado
en `docs/system-design.md`.
Un usuario puede tener varias órdenes activas si sus claves son diferentes.

## Inicializar una base nueva

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

## Actualizar una base con la restricción anterior

Para una base creada con la unicidad global anterior, aplica
`002-active-order-idempotency.sql`. No lo ejecutes después del esquema inicial
actualizado: ya incluye el índice parcial.

```powershell
docker compose cp ./scripts/sql/002-active-order-idempotency.sql postgres:/tmp/002-active-order-idempotency.sql
docker compose exec -T postgres psql -U async_order -d async_order -v ON_ERROR_STOP=1 -f /tmp/002-active-order-idempotency.sql
```

La actualización elimina `unique_order_idempotency_key` y crea
`unique_active_order_idempotency_key` en una transacción. No modifica registros.
No es idempotente: requiere la restricción anterior y se aplica una sola vez.

Verifica los índices antes o después de aplicar el script:

```powershell
docker compose exec -T postgres psql -U async_order -d async_order -c "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'orders';"
```

El resultado final debe incluir `unique_active_order_idempotency_key` y no debe
incluir `unique_order_idempotency_key` ni `unique_active_order_per_user`.

## Eliminar la restricción de una orden activa por usuario

Si tu base conserva `unique_active_order_per_user`, aplica:

```powershell
docker compose cp ./scripts/sql/003-remove-active-order-per-user.sql postgres:/tmp/003-remove-active-order-per-user.sql
docker compose exec -T postgres psql -U async_order -d async_order -v ON_ERROR_STOP=1 -f /tmp/003-remove-active-order-per-user.sql
```

El script elimina solamente ese índice, sin modificar registros ni el índice de
idempotencia activa. Usa `IF EXISTS`, por lo que puede repetirse. Para una base
con el esquema antiguo completo, aplica primero `002` y luego `003`. Una base
nueva creada con el `001` actual no requiere estas actualizaciones.

## Relación con la lógica de creación

El interceptor calcula SHA-256 del body JSON con claves de objetos ordenadas,
genera un UUID de trace y devuelve `X-Trace-Id`. No requiere una clave del cliente.
Una entrada en el `Map` local bloquea el mismo body con 409 durante 10 segundos,
incluso si la primera solicitud falla. El TTL no se renueva por duplicados.

Después del TTL, el repositorio busca la clave solamente entre órdenes
`PENDING` y `PROCESSING`. El caso de uso rechaza una coincidencia activa con 409;
no devuelve la respuesta anterior. Una orden idéntica nueva es posible cuando
la anterior terminó y expiró el TTL. Otras órdenes activas del mismo usuario
con claves diferentes no bloquean su creación.

El Map no se comparte entre instancias. El índice de PostgreSQL impide que dos
inserts concurrentes tengan la misma clave activa; el repositorio traduce su
error `23505` a un conflicto de dominio que el filtro global devuelve como 409.
Esto no garantiza recuperar una publicación fallida después de persistir la
orden; esa recuperación requiere una estrategia adicional.

## Decisiones y límites

El recorrido vigente del worker es `PENDING_CREATED` → `PROCESSING_STARTED` →
`PROCESSING_ACCOUNT_VALIDATED` → `PAID_COMPLETED`, con `CANCELLED_BY_USER` como
salida terminal, junto con `FAILED_INSUFFICIENT_FUNDS` y `FAILED_PAYMENT`.
La validación implementada comprueba solamente existencia; actividad y vigencia
son requisitos pendientes porque esos campos aún no existen en `accounts`.
Ese checkpoint no significa que se haya debitado saldo.

Los valores `PROCESSING_ACCOUNT_DEBITED`, `PROCESSING_PAYMENT_REQUESTED` y
`PROCESSING_PAYMENT_CONFIRMED` siguen permitidos por el enum y los checks del
esquema, pero no forman parte del switch vigente. Este ajuste documental no
modifica la base ni requiere ejecutar una migración.

El débito local y `PAID` / `PAID_COMPLETED` deben confirmarse en una misma
transacción. El UPDATE del saldo debe restar sobre el valor actual de PostgreSQL,
exigir fondos suficientes y comprobar elegibilidad de la cuenta al debitar.
El worker ya intenta el débito y actualiza el estado final, pero en operaciones
separadas. El repositorio usa un saldo leído previamente y una condición estricta
`balance > amount`: puede perder actualizaciones concurrentes y rechaza pagos
con saldo exacto. La resta atómica, la transacción conjunta y la protección contra
débitos repetidos de una misma orden siguen pendientes.

Los retries ya están implementados en RabbitMQ: cola durable de espera con TTL
fijo de 5 segundos y dead-letter hacia la cola principal, sin consumer adicional.
Hay hasta tres retries por cadena normal; no hay backoff ni DLQ final. Esto no
resuelve las garantías de consistencia del débito ni requiere cambios al esquema
SQL. La configuración y sus límites están en `README.md` y `docs/system-design.md`.

- Se conserva `VARCHAR` para estados y pasos, como en el SQL del documento;
  los `CHECK` restringen sus valores y exigen que el prefijo del paso coincida
  con el estado.
- `accounts` no tiene columna `version`. El diseño del débito contempla un
  UPDATE condicional atómico sobre el saldo; el worker está en desarrollo y
  esa garantía aún debe completarse en la implementación.
- Los UUID los suministra la aplicación. `created_at` y `updated_at` tienen
  `DEFAULT now()` en ambas tablas: PostgreSQL proporciona la fecha al insertar
  si se omite la columna. Los valores explícitos de la aplicación prevalecen.
- No hay trigger para actualizar `updated_at`. TypeORM lo gestiona mediante
  `@UpdateDateColumn` en sus operaciones de actualización; el SQL directo debe
  establecer `updated_at = now()` explícitamente.
- Los checks validan el estado actual, no la transición desde el anterior.
  La aplicación sigue siendo responsable de las transiciones, la autorización,
  la atomicidad entre débito y checkpoint y la idempotencia del pago externo.
- `001-create-schema.sql` es un script inicial, no una actualización incremental.
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
