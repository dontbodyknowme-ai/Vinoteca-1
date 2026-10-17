-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('no_iniciado', 'pendiente', 'aprobado', 'rechazado', 'expirado');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pagoEstado" "EstadoPago" NOT NULL DEFAULT 'no_iniciado',
ADD COLUMN     "pagoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_pagoId_key" ON "Order"("pagoId");

-- CreateIndex
CREATE INDEX "Order_pagoEstado_createdAt_idx" ON "Order"("pagoEstado", "createdAt");

