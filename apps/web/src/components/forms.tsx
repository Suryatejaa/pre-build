"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { propertyTypeSchema, propertyTypeLabel, type PropertyType, type ProjectMember, type ProjectRole } from "@property/domain";

async function mutate(url: string, method: string, data?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = result?.error;
    throw new Error(
      error?.issues?.[0]?.message ??
        error?.message ??
        result?.message ??
        "Unable to save. Please try again.",
    );
  }
  return result;
}
function Feedback({ error, success }: { error: string; success?: string }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {success && <p className="feedback success">{success}</p>}
    </div>
  );
}
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const signup = mode === "sign-up";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await mutate(`/api/auth/${mode}/email`, "POST", {
        email: form.get("email"),
        password: form.get("password"),
        ...(signup ? { name: form.get("name") } : {}),
      });
      router.replace("/projects");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      {signup && (
        <label>
          Your name
          <input
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            placeholder="How should we address you?"
          />
        </label>
      )}
      <label>
        Email address
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="you@example.com"
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={signup ? 12 : 1}
          maxLength={128}
          aria-describedby={signup ? "password-help" : undefined}
        />
      </label>
      {/* show password checkbox on same line */}
      {signup && (
        <label className="checkbox">
          <input
            type="checkbox"
            onChange={(e) => {
              const passwordInput = document.querySelector<HTMLInputElement>(
                'input[name="password"]',
              );

              if (passwordInput) {
                passwordInput.type = e.currentTarget.checked
                  ? "text"
                  : "password";
              }
            }}
          />
          <span>Show password</span>
        </label>
      )}
      {signup && (
        <p id="password-help" className="help">
          Use at least 12 characters. A memorable passphrase works well.
        </p>
      )}
      <Feedback error={error} />
      <button className="button primary full" disabled={pending}>
        {pending ? "Please wait…" : signup ? "Create your account" : "Sign in"}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="help">
        {signup ? "Already have an account?" : "New to Property Record?"}{" "}
        <Link href={signup ? "/sign-in" : "/sign-up"}>
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div>
      <button
        className="text-button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            await mutate("/api/auth/sign-out", "POST", {});
            router.replace("/sign-in");
            router.refresh();
          } catch {
            setError("Could not sign out. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      <Feedback error={error} />
    </div>
  );
}
function PropertyTypeField({ value = "RESIDENTIAL" }: { value?: PropertyType }) {
  const [selected, setSelected] = useState<string>(value);
  return (
    <div className="field-display">
      <label>
        Property type
        <select name="propertyType" defaultValue={value} onChange={event => setSelected(event.target.value)} aria-describedby="property-type-help">
          {propertyTypeSchema.options.map(type => <option key={type} value={type}>{type === "OTHER" ? "Other" : propertyTypeLabel(type)}</option>)}
        </select>
      </label>
      <p id="property-type-help" className="help">
        {selected === "RESIDENTIAL" ? "A dedicated project record for your home." : "You can create this project and record requirements. Advanced planning support is limited; requirements approval currently supports residential projects only."}
      </p>
    </div>
  );
}
export function CreateProjectForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const project = await mutate("/api/projects", "POST", {
        name: form.get("name"),
        propertyType: form.get("propertyType"),
      });
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to create project.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Project name
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="e.g. Our Hyderabad home"
          autoFocus
        />
      </label>
      <p className="help">
        Choose a name that is meaningful to you. You can change it later.
      </p>
      <PropertyTypeField />
      <Feedback error={error} />
      <div className="form-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Creating project…" : "Create project"}
          <span aria-hidden="true">↗</span>
        </button>
        <Link className="button quiet" href="/projects">
          Cancel
        </Link>
      </div>
    </form>
  );
}
export function EditProjectForm({
  project,
}: {
  project: {
    id: string;
    name: string;
    status: "ACTIVE" | "ARCHIVED";
    propertyType: PropertyType;
    revision: number;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await mutate(`/api/projects/${project.id}`, "PATCH", {
        name: form.get("name"),
        status: form.get("status"),
        propertyType: form.get("propertyType"),
        expectedRevision: project.revision,
        changeReason: form.get("changeReason"),
      });
      setSuccess("Project saved. Your previous versions remain available.");
      const reason = formElement.elements.namedItem("changeReason");
      if (reason instanceof HTMLTextAreaElement) reason.value = "";
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <label>
        Project name
        <input
          name="name"
          defaultValue={project.name}
          required
          minLength={2}
          maxLength={120}
        />
      </label>
      <PropertyTypeField value={project.propertyType} />
      <p className="help">After changing the property type, review Requirements in a new draft. Previously approved briefs remain in history.</p>
      <label>
        Project status
        <select name="status" defaultValue={project.status}>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </label>
      <p className="help">
        Archiving keeps the project and its full history. You can make it active
        again here.
      </p>
      <label>
        What changed?
        <textarea
          name="changeReason"
          placeholder="A short note for your project history"
          rows={3}
          minLength={5}
          maxLength={500}
          required
        />
      </label>
      <Feedback error={error} success={success} />
      {error.includes("Reload") && (
        <button
          type="button"
          className="text-button"
          onClick={() => router.refresh()}
        >
          Reload the latest version
        </button>
      )}
      <button className="button primary self-start" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
const roleLabels: Record<ProjectRole, string> = {
  OWNER: "Owner",
  PROFESSIONAL: "Professional",
  CONTRACTOR_VIEWER: "Contractor · viewer",
  CONTRACTOR_CONTRIBUTOR: "Contractor · contributor",
};
export function AccessForm({
  projectId,
  members,
}: {
  projectId: string;
  members: ProjectMember[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await mutate(`/api/projects/${projectId}/members`, "PUT", {
        userId: form.get("userId"),
        role: form.get("role"),
      });
      formElement.reset();
      setSuccess("Project access updated.");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to update access.",
      );
    } finally {
      setPending(false);
    }
  }
  async function remove(userId: string) {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await mutate(`/api/projects/${projectId}/members/${userId}`, "DELETE");
      setSuccess("Access removed.");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to remove access.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <ul className="member-list">
        {members.map((member) => (
          <li key={member.userId}>
            <div>
              <strong>{member.name}</strong>
              <span>{roleLabels[member.role]}</span>
              <code>{member.userId}</code>
            </div>
            {member.role !== "OWNER" && (
              <button
                className="text-button danger"
                disabled={pending}
                onClick={() => remove(member.userId)}
                aria-label={`Remove access for ${member.name}`}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="form-stack section-top" onSubmit={submit}>
        <h2>Give someone access</h2>
        <p className="help">
          Ask them for the account ID on their Account page. Use the same ID
          again to change their role.
        </p>
        <label>
          Account ID
          <input
            name="userId"
            required
            placeholder="00000000-0000-0000-0000-000000000000"
            pattern="[0-9a-fA-F-]{36}"
            maxLength={36}
          />
        </label>
        <label>
          Role
          <select name="role" defaultValue="CONTRACTOR_VIEWER">
            <option value="CONTRACTOR_VIEWER">Contractor viewer</option>
            <option value="CONTRACTOR_CONTRIBUTOR">
              Contractor contributor
            </option>
            <option value="PROFESSIONAL">Professional</option>
          </select>
        </label>
        <p className="help">
          Contractors can currently see the project summary. Professionals can
          also read metadata history. Land/site details and private change notes
          remain owner-only. Only you can edit project details and manage
          access.
        </p>
        <Feedback error={error} success={success} />
        <button className="button primary self-start" disabled={pending}>
          {pending ? "Updating…" : "Save access"}
        </button>
      </form>
    </>
  );
}
