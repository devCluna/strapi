import { z, errors } from '@strapi/utils';

interface FormattedZodError {
  path: PropertyKey[];
  message: string;
  name: 'ValidationError';
}

interface FormattedZodErrors {
  errors: FormattedZodError[];
  message: string;
}

/**
 * Transforms a ZodError into the same shape as formatYupErrors from @strapi/utils.
 * Only keeps the first error per path to match Yup behavior.
 */
const formatZodErrors = (zodError: z.ZodError): FormattedZodErrors => {
  const seen = new Set<string>();
  const errors: FormattedZodError[] = [];

  for (const issue of zodError.issues) {
    const key = issue.path.join('.');
    if (!seen.has(key)) {
      seen.add(key);
      errors.push({
        path: issue.path,
        message: issue.message,
        name: 'ValidationError',
      });
    }
  }

  return {
    errors,
    message: 'Validation error',
  };
};

/**
 * Zod schema for Strapi entity IDs.
 * Matches the StrapiIDSchema from @strapi/utils/yup:
 * accepts strings or non-negative integers.
 */
const strapiID = z.union([z.string(), z.number().int().nonnegative()]);

/**
 * Async Zod validator matching the signature of validateYupSchema from @strapi/utils.
 *
 * Usage:
 *   const validate = validateZodAsync(mySchema);
 *   const data = await validate(body);            // throws ValidationError on failure
 *   const data = await validate(body, 'Custom');  // throws with custom message
 */
const validateZodAsync =
  <T extends z.Schema>(schema: T) =>
  async (data: unknown, errorMessage?: string): Promise<z.infer<T>> => {
    try {
      return await schema.parseAsync(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const { message, errors: formattedErrors } = formatZodErrors(error);
        throw new errors.ValidationError(errorMessage || message, {
          errors: formattedErrors,
        });
      }
      throw error;
    }
  };

export { formatZodErrors, strapiID, validateZodAsync };
export type { FormattedZodError, FormattedZodErrors };
