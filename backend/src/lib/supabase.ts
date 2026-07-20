import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("⚠️ Warning: SUPABASE_URL or SUPABASE_SERVICE_KEY is not defined in the environment.");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
