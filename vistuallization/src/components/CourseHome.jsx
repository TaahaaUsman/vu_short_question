export function CourseHome({ courses, loading, error, onSelect }) {
  if (loading) {
    return (
      <div className="course-home">
        <p className="muted">Loading courses…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="course-home">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  return (
    <div className="course-home">
      <header className="home-header">
        <p className="home-kicker">Short questions</p>
        <h1 className="home-title">Choose a course</h1>
        <p className="home-desc muted">
          Open a course to browse lectures and VU-style short questions with structured answers.
        </p>
      </header>

      <div className="course-grid">
        {courses.map((c) => (
          <button
            key={c.id}
            type="button"
            className="course-card"
            onClick={() => onSelect(c)}
          >
            <span className="course-card__code">{c.code}</span>
            <h2 className="course-card__title">{c.title}</h2>
            <p className="course-card__sub muted">{c.subtitle}</p>
            <span className="course-card__cta">Open →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
