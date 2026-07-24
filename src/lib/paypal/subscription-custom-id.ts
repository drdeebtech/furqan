import "server-only";

import { z } from "zod";

const CUSTOM_ID_VERSION = "v1";
const MAX_PAYPAL_CUSTOM_ID_LENGTH = 127;

const ProductTypeSchema = z.enum([
  "subscription",
  "subscription_upgrade",
  "prepaid_hours",
  "single_session",
]);

const BuildableProductTypeSchema = z.enum([
  "subscription",
  "subscription_upgrade",
]);

const StudentIdSchema = z.string().uuid();
const PlanCodeSchema = z.string().min(1);

export type PayPalCustomIdProductType = z.infer<typeof ProductTypeSchema>;
export type BuildableSubscriptionProductType = z.infer<
  typeof BuildableProductTypeSchema
>;

export interface ParsedSubscriptionCustomId {
  productType: PayPalCustomIdProductType;
  studentId: string;
  planCode: string;
  extra: string | null;
}

function containsDelimiter(value: string): boolean {
  return value.includes("|");
}

export function buildSubscriptionCustomId(args: {
  productType: "subscription" | "subscription_upgrade";
  studentId: string;
  planCode: string;
  extra?: string;
}): string {
  const productType = BuildableProductTypeSchema.parse(args.productType);
  const studentId = StudentIdSchema.parse(args.studentId);
  const planCode = PlanCodeSchema.parse(args.planCode);

  if (
    containsDelimiter(productType) ||
    containsDelimiter(studentId) ||
    containsDelimiter(planCode) ||
    (args.extra !== undefined && containsDelimiter(args.extra))
  ) {
    throw new Error("PayPal custom_id fields must not contain '|'.");
  }

  const fields = [CUSTOM_ID_VERSION, productType, studentId, planCode];
  if (args.extra !== undefined) {
    fields.push(args.extra);
  }

  const customId = fields.join("|");
  if (customId.length > MAX_PAYPAL_CUSTOM_ID_LENGTH) {
    throw new Error("PayPal custom_id exceeds 127 characters.");
  }

  return customId;
}

export function parseSubscriptionCustomId(
  customId: string,
  opts?: { knownPlanCodes?: Set<string> },
): ParsedSubscriptionCustomId | null {
  try {
    // A custom_id longer than PayPal's cap cannot be one we built — reject
    // before splitting (defense-in-depth; mirrors the build-side length guard).
    if (customId.length > MAX_PAYPAL_CUSTOM_ID_LENGTH) {
      return null;
    }
    const fields = customId.split("|");
    if (fields.length !== 4 && fields.length !== 5) {
      return null;
    }

    const [version, productTypeRaw, studentIdRaw, planCodeRaw, extra] = fields;
    if (version !== CUSTOM_ID_VERSION) {
      return null;
    }

    const productType = ProductTypeSchema.safeParse(productTypeRaw);
    if (!productType.success) {
      return null;
    }

    const studentId = StudentIdSchema.safeParse(studentIdRaw);
    if (!studentId.success) {
      return null;
    }

    const planCode = PlanCodeSchema.safeParse(planCodeRaw);
    if (!planCode.success) {
      return null;
    }

    if (
      opts?.knownPlanCodes &&
      !opts.knownPlanCodes.has(planCode.data)
    ) {
      return null;
    }

    return {
      productType: productType.data,
      studentId: studentId.data,
      planCode: planCode.data,
      extra: fields.length === 5 ? extra ?? "" : null,
    };
  } catch {
    return null;
  }
}
