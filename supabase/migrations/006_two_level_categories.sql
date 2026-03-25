-- 006_two_level_categories.sql
-- Upgrade categories to two-level hierarchy (Category → Subcategory)
-- Add direction, is_system, is_archived, sort_order to categories
-- Add subcategory_id to transactions
-- Clear old flat categories and seed new hierarchy for all existing users

-- 1. New columns on categories
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS direction   text    CHECK (direction IN ('expense','income','transfer')),
  ADD COLUMN IF NOT EXISTS is_system   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 0;

-- 2. subcategory_id on transactions (references a category with parent_id set)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS subcategory_id uuid
    REFERENCES public.categories(id) ON DELETE SET NULL;

-- 3. Wipe existing category assignments (user explicitly requested this)
UPDATE public.transactions SET category_id = NULL, subcategory_id = NULL;

-- 4. Delete all existing categories (old flat structure)
DELETE FROM public.categories;

-- 5. Seed function for new two-level hierarchy
CREATE OR REPLACE FUNCTION public.seed_categories_v2(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cat_housing    uuid := gen_random_uuid();
  cat_food       uuid := gen_random_uuid();
  cat_transport  uuid := gen_random_uuid();
  cat_health     uuid := gen_random_uuid();
  cat_personal   uuid := gen_random_uuid();
  cat_financial  uuid := gen_random_uuid();
  cat_travel     uuid := gen_random_uuid();
  cat_education  uuid := gen_random_uuid();
  cat_children   uuid := gen_random_uuid();
  cat_income     uuid := gen_random_uuid();
  cat_reimburse  uuid := gen_random_uuid();
  cat_passive    uuid := gen_random_uuid();
  cat_other_inc  uuid := gen_random_uuid();
  cat_transfers  uuid := gen_random_uuid();
BEGIN
  -- Remove existing system categories for this user
  DELETE FROM public.categories WHERE user_id = p_user_id AND is_system = true AND parent_id IS NOT NULL;
  DELETE FROM public.categories WHERE user_id = p_user_id AND is_system = true AND parent_id IS NULL;

  -- ── Top-level expense categories ──────────────────────────────
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (cat_housing,   p_user_id, 'Housing',              NULL, 'expense', true,  10, '#6366F1', false),
    (cat_food,      p_user_id, 'Food & Drink',         NULL, 'expense', true,  20, '#10B981', false),
    (cat_transport, p_user_id, 'Transport',            NULL, 'expense', true,  30, '#F59E0B', false),
    (cat_health,    p_user_id, 'Health & Wellness',    NULL, 'expense', true,  40, '#EF4444', false),
    (cat_personal,  p_user_id, 'Personal & Lifestyle', NULL, 'expense', true,  50, '#EC4899', false),
    (cat_financial, p_user_id, 'Financial',            NULL, 'expense', true,  60, '#8B5CF6', false),
    (cat_travel,    p_user_id, 'Travel',               NULL, 'expense', true,  70, '#14B8A6', false),
    (cat_education, p_user_id, 'Education & Work',     NULL, 'expense', true,  80, '#F97316', false),
    (cat_children,  p_user_id, 'Children & Family',    NULL, 'expense', true,  90, '#84CC16', false);

  -- Housing subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Rent / Mortgage',          cat_housing, 'expense', true, 1, '#6366F1', false),
    (gen_random_uuid(), p_user_id, 'Utilities',                cat_housing, 'expense', true, 2, '#6366F1', false),
    (gen_random_uuid(), p_user_id, 'Internet & Phone',         cat_housing, 'expense', true, 3, '#6366F1', false),
    (gen_random_uuid(), p_user_id, 'Home Insurance',           cat_housing, 'expense', true, 4, '#6366F1', false),
    (gen_random_uuid(), p_user_id, 'Maintenance & Repairs',    cat_housing, 'expense', true, 5, '#6366F1', false),
    (gen_random_uuid(), p_user_id, 'Furnishings & Appliances', cat_housing, 'expense', true, 6, '#6366F1', false);

  -- Food & Drink subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Groceries',             cat_food, 'expense', true, 1, '#10B981', false),
    (gen_random_uuid(), p_user_id, 'Restaurants & Dining',  cat_food, 'expense', true, 2, '#10B981', false),
    (gen_random_uuid(), p_user_id, 'Coffee & Café',         cat_food, 'expense', true, 3, '#10B981', false),
    (gen_random_uuid(), p_user_id, 'Delivery & Takeout',    cat_food, 'expense', true, 4, '#10B981', false),
    (gen_random_uuid(), p_user_id, 'Alcohol & Bars',        cat_food, 'expense', true, 5, '#10B981', false);

  -- Transport subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Public Transit',           cat_transport, 'expense', true, 1, '#F59E0B', false),
    (gen_random_uuid(), p_user_id, 'Fuel',                     cat_transport, 'expense', true, 2, '#F59E0B', false),
    (gen_random_uuid(), p_user_id, 'Car Insurance',            cat_transport, 'expense', true, 3, '#F59E0B', false),
    (gen_random_uuid(), p_user_id, 'Car Maintenance',          cat_transport, 'expense', true, 4, '#F59E0B', false),
    (gen_random_uuid(), p_user_id, 'Parking',                  cat_transport, 'expense', true, 5, '#F59E0B', false),
    (gen_random_uuid(), p_user_id, 'Taxi & Ride-share',        cat_transport, 'expense', true, 6, '#F59E0B', false);

  -- Health & Wellness subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Doctor & Dentist',        cat_health, 'expense', true, 1, '#EF4444', false),
    (gen_random_uuid(), p_user_id, 'Pharmacy & Medication',   cat_health, 'expense', true, 2, '#EF4444', false),
    (gen_random_uuid(), p_user_id, 'Gym & Fitness',           cat_health, 'expense', true, 3, '#EF4444', false),
    (gen_random_uuid(), p_user_id, 'Therapy & Mental Health', cat_health, 'expense', true, 4, '#EF4444', false),
    (gen_random_uuid(), p_user_id, 'Health Insurance',        cat_health, 'expense', true, 5, '#EF4444', false);

  -- Personal & Lifestyle subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Clothing & Shoes',            cat_personal, 'expense', true, 1, '#EC4899', false),
    (gen_random_uuid(), p_user_id, 'Grooming & Haircuts',         cat_personal, 'expense', true, 2, '#EC4899', false),
    (gen_random_uuid(), p_user_id, 'Subscriptions & Memberships', cat_personal, 'expense', true, 3, '#EC4899', false),
    (gen_random_uuid(), p_user_id, 'Hobbies & Recreation',        cat_personal, 'expense', true, 4, '#EC4899', false),
    (gen_random_uuid(), p_user_id, 'Gifts & Donations',           cat_personal, 'expense', true, 5, '#EC4899', false);

  -- Financial subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Bank Fees',            cat_financial, 'expense', true, 1, '#8B5CF6', false),
    (gen_random_uuid(), p_user_id, 'Interest Payments',    cat_financial, 'expense', true, 2, '#8B5CF6', false),
    (gen_random_uuid(), p_user_id, 'Loan Repayments',      cat_financial, 'expense', true, 3, '#8B5CF6', false),
    (gen_random_uuid(), p_user_id, 'Savings & Investments',cat_financial, 'expense', true, 4, '#8B5CF6', false);

  -- Travel subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Flights',                cat_travel, 'expense', true, 1, '#14B8A6', false),
    (gen_random_uuid(), p_user_id, 'Accommodation',          cat_travel, 'expense', true, 2, '#14B8A6', false),
    (gen_random_uuid(), p_user_id, 'Activities & Excursions',cat_travel, 'expense', true, 3, '#14B8A6', false),
    (gen_random_uuid(), p_user_id, 'Travel Food & Drink',    cat_travel, 'expense', true, 4, '#14B8A6', false),
    (gen_random_uuid(), p_user_id, 'Travel Transport',       cat_travel, 'expense', true, 5, '#14B8A6', false);

  -- Education & Work subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Courses & Training',        cat_education, 'expense', true, 1, '#F97316', false),
    (gen_random_uuid(), p_user_id, 'Books & Learning Materials',cat_education, 'expense', true, 2, '#F97316', false),
    (gen_random_uuid(), p_user_id, 'Software & Tools',          cat_education, 'expense', true, 3, '#F97316', false),
    (gen_random_uuid(), p_user_id, 'Office Supplies',           cat_education, 'expense', true, 4, '#F97316', false);

  -- Children & Family subcategories
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Childcare & Preschool',   cat_children, 'expense', true, 1, '#84CC16', false),
    (gen_random_uuid(), p_user_id, 'Children''s Clothing',    cat_children, 'expense', true, 2, '#84CC16', false),
    (gen_random_uuid(), p_user_id, 'Toys & Activities',       cat_children, 'expense', true, 3, '#84CC16', false),
    (gen_random_uuid(), p_user_id, 'School Supplies & Fees',  cat_children, 'expense', true, 4, '#84CC16', false);

  -- ── Top-level income categories ────────────────────────────────
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (cat_income,    p_user_id, 'Earned Income',               NULL, 'income', true, 110, '#3B82F6', false),
    (cat_reimburse, p_user_id, 'Reimbursements',              NULL, 'income', true, 120, '#06B6D4', false),
    (cat_passive,   p_user_id, 'Passive & Investment Income', NULL, 'income', true, 130, '#A855F7', false),
    (cat_other_inc, p_user_id, 'Other Income',                NULL, 'income', true, 140, '#64748B', false);

  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Salary / Wages',      cat_income, 'income', true, 1, '#3B82F6', false),
    (gen_random_uuid(), p_user_id, 'Freelance & Side Work',cat_income,'income', true, 2, '#3B82F6', false),
    (gen_random_uuid(), p_user_id, 'Bonus',               cat_income, 'income', true, 3, '#3B82F6', false),
    (gen_random_uuid(), p_user_id, 'Overtime',            cat_income, 'income', true, 4, '#3B82F6', false);

  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Employer Reimbursement', cat_reimburse, 'income', true, 1, '#06B6D4', false),
    (gen_random_uuid(), p_user_id, 'Shared Cost Settlement', cat_reimburse, 'income', true, 2, '#06B6D4', false),
    (gen_random_uuid(), p_user_id, 'Insurance Payout',       cat_reimburse, 'income', true, 3, '#06B6D4', false),
    (gen_random_uuid(), p_user_id, 'Tax Refund',             cat_reimburse, 'income', true, 4, '#06B6D4', false);

  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Interest',       cat_passive, 'income', true, 1, '#A855F7', false),
    (gen_random_uuid(), p_user_id, 'Dividends',      cat_passive, 'income', true, 2, '#A855F7', false),
    (gen_random_uuid(), p_user_id, 'Capital Gains',  cat_passive, 'income', true, 3, '#A855F7', false),
    (gen_random_uuid(), p_user_id, 'Rental Income',  cat_passive, 'income', true, 4, '#A855F7', false);

  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Gifts Received',        cat_other_inc, 'income', true, 1, '#64748B', false),
    (gen_random_uuid(), p_user_id, 'Government Benefits',   cat_other_inc, 'income', true, 2, '#64748B', false),
    (gen_random_uuid(), p_user_id, 'Selling Personal Items',cat_other_inc, 'income', true, 3, '#64748B', false),
    (gen_random_uuid(), p_user_id, 'Miscellaneous',         cat_other_inc, 'income', true, 4, '#64748B', false);

  -- ── Top-level transfer category ────────────────────────────────
  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (cat_transfers, p_user_id, 'Transfers', NULL, 'transfer', true, 200, '#94A3B8', false);

  INSERT INTO public.categories (id, user_id, name, parent_id, direction, is_system, sort_order, color, is_shared) VALUES
    (gen_random_uuid(), p_user_id, 'Between Own Accounts',   cat_transfers, 'transfer', true, 1, '#94A3B8', false),
    (gen_random_uuid(), p_user_id, 'To/From Shared Account', cat_transfers, 'transfer', true, 2, '#94A3B8', false);

END;
$$;

-- 6. Run for all existing users
DO $$
DECLARE u uuid;
BEGIN
  FOR u IN (SELECT id FROM auth.users) LOOP
    PERFORM public.seed_categories_v2(u);
  END LOOP;
END;
$$;

-- 7. Update new-user trigger to call v2 seed
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, default_currency, date_format)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'name', ''), 'SEK', 'DD/MM/YYYY')
  ON CONFLICT (id) DO NOTHING;
  PERFORM public.seed_categories_v2(new.id);
  RETURN new;
END;
$$;
