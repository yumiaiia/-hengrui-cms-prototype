import { lazy, Suspense, useEffect, useState } from "react";
import { useCMS } from "./store";
import Shell from "./components/Shell";
import Workbench from "./pages/Workbench";
import ContentLibrary from "./pages/ContentLibrary";
import { Button, Empty } from "./components/ui";
import { go } from "./model";
const UploadWizard = lazy(() => import("./pages/UploadWizard"));
const ContentDetail = lazy(() => import("./pages/ContentDetail"));
const Credentials = lazy(() => import("./pages/Credentials"));
const Collection = lazy(() => import("./pages/Collection"));
const Tags = lazy(() => import("./pages/Tags"));
const Administration = lazy(() => import("./pages/Administration"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Login = lazy(() => import("./pages/Login"));
export default function App() {
  const { user, role } = useCMS();
  const [hash, setHash] = useState(location.hash || "#/workbench");
  useEffect(() => {
    let previous = location.hash || "#/workbench";
    const change = () => {
      const next = location.hash || "#/workbench";
      const oldRoute = previous.replace(/^#\//, "").split(/[/?]/)[0];
      const nextRoute = next.replace(/^#\//, "").split(/[/?]/)[0];
      if (oldRoute === "library")
        sessionStorage.setItem(
          "hengrui-cms-library-scroll",
          String(window.scrollY),
        );
      previous = next;
      setHash(next);
      requestAnimationFrame(() =>
        window.scrollTo(
          0,
          nextRoute === "library" && oldRoute === "content"
            ? Number(sessionStorage.getItem("hengrui-cms-library-scroll")) || 0
            : 0,
        ),
      );
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const path = hash.replace(/^#\//, "").split("?")[0];
  const [route, id] = path.split("/");
  const loading = (
    <div className="loading-page">
      <span className="loading-spinner" />
      正在打开工作区…
    </div>
  );
  if (!user || route === "login")
    return (
      <Suspense fallback={loading}>
        <Login />
      </Suspense>
    );
  const menu = route === "upload" || route === "content" ? "library" : route;
  const allowed = route === "tasks" || role?.menus.includes(menu);
  let content;
  if (!allowed)
    content = (
      <Empty
        title="没有此页面的访问权限"
        description="请联系管理员确认菜单与数据授权。"
        action={<Button onClick={() => go("workbench")}>返回工作台</Button>}
      />
    );
  else
    switch (route) {
      case "workbench":
        content = <Workbench />;
        break;
      case "library":
        content = <ContentLibrary />;
        break;
      case "upload":
        content = <UploadWizard />;
        break;
      case "content":
        content = <ContentDetail id={id} />;
        break;
      case "credentials":
        content = <Credentials />;
        break;
      case "collection":
        content = <Collection />;
        break;
      case "tags":
        content = <Tags />;
        break;
      case "admin":
        content = <Administration />;
        break;
      case "tasks":
        content = <Tasks />;
        break;
      default:
        content = (
          <Empty
            title="页面不存在"
            action={<Button onClick={() => go("workbench")}>返回工作台</Button>}
          />
        );
    }
  return (
    <Shell route={route}>
      <Suspense fallback={loading}>
        <div key={hash}>{content}</div>
      </Suspense>
    </Shell>
  );
}
