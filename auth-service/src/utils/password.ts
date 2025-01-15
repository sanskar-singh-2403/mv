import bcrypt from 'bcryptjs';  // Changed from 'bcrypt' to 'bcryptjs'

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

export async function comparePasswords(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}