/**
 * Short tag next to a team: "Better" (green) for the team our score favours, "Worse" (red) for the other one.
 * @param favoured whether the tagged team (or the bet on it) is on the side our score favours
 */
function FavourTag({ favoured }: { favoured: boolean }) {
  return (
    <span
      className={`favour-tag ${favoured ? 'favour-tag-yes' : 'favour-tag-no'}`}
      title={favoured ? 'Our score favours this team' : 'Our score favours the other team'}
    >
      {favoured ? 'Better' : 'Worse'}
    </span>
  )
}

export default FavourTag
