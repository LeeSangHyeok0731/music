import { Studio } from "@/components/studio/Studio";
import { StudioProvider } from "@/state/StudioProvider";

// 서버 컴포넌트. 상태와 오디오는 클라이언트 경계(`StudioProvider`, `Studio`) 안에서만 다룬다.
export default function Home() {
  return (
    <StudioProvider>
      <Studio />
    </StudioProvider>
  );
}
