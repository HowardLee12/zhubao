export default function DemoLoading() {
  return (
    <div
      role="status"
      aria-label="Renoly 示範載入中"
      className="relative left-1/2 min-h-dvh w-screen -translate-x-1/2 bg-[#f8f2e9] px-4 py-6"
    >
      <span className="sr-only">Renoly 示範載入中</span>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="h-12 w-40 animate-pulse rounded-2xl bg-white motion-reduce:animate-none" />
        <div className="h-12 w-full animate-pulse rounded-2xl bg-orange-soft motion-reduce:animate-none" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-2xl bg-white motion-reduce:animate-none"
            />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-[24px] bg-white motion-reduce:animate-none" />
      </div>
    </div>
  );
}

