import type { NextPageContext } from "next";

type Props = {
  statusCode?: number;
};

function ErrorPage({ statusCode }: Props) {
  const title = statusCode ? `Error ${statusCode}` : "Error";
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
      <p style={{ marginTop: 12, color: "#666" }}>
        Something went wrong. Please try again.
      </p>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;

