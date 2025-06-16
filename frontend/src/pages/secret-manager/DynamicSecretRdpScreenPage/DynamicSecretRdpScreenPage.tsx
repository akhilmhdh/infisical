import { useUser, useWorkspace } from "@app/context";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const DynamicSecretRdpScreenPage = () => {
  const { currentWorkspace } = useWorkspace();
  const { user } = useUser();
  const search = useSearch({
    from: "/_authenticate/_inject-org-details/_org-layout/secret-manager/$projectId/_secret-manager-layout/rdp-screen"
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.display = "inline";
      canvasRef.current.width = window.innerWidth;
      canvasRef.current.height = window.innerHeight;

      const client = window.Mstsc.client.create(canvasRef.current);
      console.log({
        dynamicSecretName: search.dynamicSecretName,
        environmentSlug: search.environment,
        secretPath: search.secretPath,
        projectSlug: currentWorkspace.slug,
        orgId: currentWorkspace.orgId,
        userId: user.id
      });
      client.connect(
        {
          dynamicSecretName: search.dynamicSecretName,
          environmentSlug: search.environment,
          secretPath: search.secretPath,
          projectSlug: currentWorkspace.slug,
          orgId: currentWorkspace.orgId,
          userId: user.id
        },
        function (err) {
          console.log(err);
          canvasRef.current.style.display = "none";
        }
      );
    }
  }, [canvasRef.current]);

  return (
    <div>
      <canvas id="myCanvas" ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
};
