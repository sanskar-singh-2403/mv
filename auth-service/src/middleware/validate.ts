import { Request, Response, NextFunction } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

const registrationRules: ValidationChain[] = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
];

const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    res.status(400).json({
      success: false,
      errors: errors.array()
    });
  };
};

export const validateRegistration = [
  ...registrationRules,
  validate(registrationRules)
];