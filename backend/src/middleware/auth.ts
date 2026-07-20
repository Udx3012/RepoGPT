import { Request, Response, NextFunction } from "express";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  (req as any).user = {
    id: "default-user",
    email: "user@repogpt.local",
  };
  next();
}
