-- KEG-04: the semester character report is queued as an export job of its own target.
ALTER TYPE "public"."export_target" ADD VALUE 'rapor_karakter';
