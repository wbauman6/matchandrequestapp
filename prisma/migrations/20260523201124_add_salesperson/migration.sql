-- CreateTable
CREATE TABLE "Salesperson" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Salesperson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Salesperson_shop_idx" ON "Salesperson"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Salesperson_shop_email_key" ON "Salesperson"("shop", "email");
