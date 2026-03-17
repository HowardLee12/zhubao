export default function Loading() {
  return (
    <div className="pb-20 px-4 pt-4 space-y-4 animate-pulse">
      <div className="h-8 bg-sage-100 rounded-lg w-24" />
      <div className="space-y-2">
        <div className="h-16 bg-sage-100 rounded-xl mx-4" />
        <div className="h-16 bg-sage-100 rounded-xl mx-4" />
        <div className="h-16 bg-sage-100 rounded-xl mx-4" />
      </div>
    </div>
  );
}
