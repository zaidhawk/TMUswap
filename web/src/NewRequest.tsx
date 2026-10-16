import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, SUPPORT_EMAIL, type Course, type Section, type SectionKind } from "./api";
import { KIND_LABELS, parseSectionList } from "./sections";

export function NewRequest() {
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [kind, setKind] = useState<SectionKind>("lecture");
  const [have, setHave] = useState("");
  const [wantsText, setWantsText] = useState("");
  const [noWaitlist, setNoWaitlist] = useState(false);
  const [knownSections, setKnownSections] = useState<Section[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Sections other students already posted, offered as suggestions to avoid typos.
  useEffect(() => {
    if (!course) return;
    api<{ sections: Section[] }>(`/courses/${course.id}/sections`)
      .then(({ sections }) => setKnownSections(sections))
      .catch(() => setKnownSections([]));
  }, [course]);
  const suggestions = knownSections.filter((s) => s.kind === kind).map((s) => s.label);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!course) return;
    setError("");
    setBusy(true);
    try {
      await api("/requests", {
        method: "POST",
        body: { courseId: course.id, kind, have, wants: parseSectionList(wantsText), noWaitlist },
      });
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!course) return <CoursePicker onPick={setCourse} />;

  return (
    <form onSubmit={submit}>
      <h2>New swap request</h2>
      <div className="card">
        <div className="card-head">
          <strong>{course.code}</strong>
          <button type="button" className="link" onClick={() => setCourse(null)}>
            Change
          </button>
        </div>
        <p className="hint">{course.title}</p>
      </div>

      <fieldset>
        <legend>What are you swapping?</legend>
        <div className="row">
          {(Object.keys(KIND_LABELS) as SectionKind[]).map((k) => (
            <label key={k} className="choice">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              {KIND_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <datalist id="known-sections">
        {suggestions.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>

      <label>
        Your {KIND_LABELS[kind].toLowerCase()} section
        <input
          inputMode="numeric"
          placeholder="011"
          list="known-sections"
          value={have}
          onChange={(e) => setHave(e.target.value)}
          required
        />
      </label>

      <label>
        Sections you'd take instead
        <input placeholder="012, 015" value={wantsText} onChange={(e) => setWantsText(e.target.value)} required />
        <span className="hint">Separate them with commas. You'll be matched with any of them.</span>
      </label>

      <label className="choice">
        <input type="checkbox" checked={noWaitlist} onChange={(e) => setNoWaitlist(e.target.checked)} />
        <span>
          None of these sections has a wait list. (If it did, the seat would go to the next person on the wait list, not
          your swap partner.)
        </span>
      </label>

      {error && <p className="error">{error}</p>}
      <button disabled={busy || !noWaitlist}>{busy ? "Posting…" : "Post request"}</button>
    </form>
  );
}

function CoursePicker({ onPick }: { onPick: (course: Course) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Course[] | null>(null);

  // Search 250 ms after the student stops typing, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      api<{ courses: Course[] }>(`/courses?q=${encodeURIComponent(q)}`)
        .then(({ courses }) => setResults(courses))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <section>
      <h2>New swap request</h2>
      <label>
        Find your course
        <input placeholder="CPS 510 or Database" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      {results?.map((c) => (
        <button key={c.id} type="button" className="result" onClick={() => onPick(c)}>
          <strong>{c.code}</strong> {c.title}
        </button>
      ))}
      {results?.length === 0 && <p className="hint">No courses found.</p>}
      <p className="hint">
        Can't find your course?{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Add a course to TMU Swap")}`}>Email us</a> and
        we'll add it.
      </p>
    </section>
  );
}
