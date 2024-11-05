// app/services/auth.server.ts
import { Authenticator } from "remix-auth";
import { sessionStorage } from "~/services/session.server";
import { FormStrategy } from "remix-auth-form";

// Define the User type
type User = {
  id: string;
  email: string;
};

// Create an instance of the authenticator, pass a generic with what
// strategies will return and will store in the session
export let authenticator = new Authenticator<User>(sessionStorage);

// Define the login function
async function login(email: string, password: string): Promise<User | null> {
  // Replace this with your actual authentication logic
  if (email === "user@example.com" && password === "password") {
    return { id: "1", email };
  }
  return null;
}

// Tell the Authenticator to use the form strategy
authenticator.use(
  new FormStrategy(async ({ form }) => {
    let email = form.get("email") as string;
    let password = form.get("password") as string;
    let user = await login(email, password);
    if (!user) {
      throw new Error("Invalid credentials");
    }
    return user;
  }),
  "user-pass"
);