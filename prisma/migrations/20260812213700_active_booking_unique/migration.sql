-- A member can hold at most one live booking (BOOKED or WAITLISTED) per class,
-- but may re-book after cancelling. Prisma cannot express a partial unique
-- index, so it is declared here and enforced by the database.
CREATE UNIQUE INDEX "Booking_active_member_per_class"
  ON "Booking" ("classInstanceId", "memberId")
  WHERE "status" <> 'CANCELLED';
