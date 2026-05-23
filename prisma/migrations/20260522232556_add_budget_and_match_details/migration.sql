-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "productImage" TEXT,
ADD COLUMN     "productPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "budget" DOUBLE PRECISION;
