-- AlterTable
ALTER TABLE "OrderTimeline" ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'Admin',
ADD COLUMN     "pagoEstado" "EstadoPago",
ALTER COLUMN "status" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OrderTimeline_pagoEstado_idx" ON "OrderTimeline"("pagoEstado");

