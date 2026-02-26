import { z } from 'zod';

type FormErrors = Record<string, string>;

/**
 * Converts a ZodError into form-compatible errors matching
 * getYupValidationErrors from @strapi/admin Form component.
 *
 * Returns a flat object with dot-path keys and string error messages.
 * Only the first error per path is kept (matches Yup behavior).
 */
const getZodValidationErrors = (error: z.ZodError): FormErrors => {
  const errors: FormErrors = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (path && !(path in errors)) {
      errors[path] = issue.message;
    }
  }

  return errors;
};

export { getZodValidationErrors };
