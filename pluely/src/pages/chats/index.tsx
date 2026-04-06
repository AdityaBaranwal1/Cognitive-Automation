import { Badge, Input, Card, Empty, Button } from "@/components";
import { useHistory } from "@/hooks";
import { PageLayout } from "@/layouts";
import { MessageCircleIcon, Search, Trash2 } from "lucide-react";
import moment from "moment";
import { useNavigate } from "react-router-dom";
import { DeleteConfirmationDialog } from "./components";
import { useState } from "react";

const Dashboard = () => {
  const conversations = useHistory();
  const navigate = useNavigate();
  const [clearAllConfirm, setClearAllConfirm] = useState(false);

  // Group conversations by date
  const groupedConversations = conversations.conversations.reduce(
    (acc, doc) => {
      const dateKey = moment(doc.updatedAt).format("YYYY-MM-DD");
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(doc);
      return acc;
    },
    {} as Record<string, typeof conversations.conversations>
  );

  // Sort dates in descending order (most recent first)
  const sortedDates = Object.keys(groupedConversations).sort((a, b) =>
    moment(b).diff(moment(a))
  );

  return (
    <PageLayout
      title="All conversations"
      description="View all your conversations"
    >
      <>
        {conversations.conversations.length === 0 ? (
          <Empty
            isLoading={conversations.isLoading}
            icon={MessageCircleIcon}
            title="No conversations found"
            description="Start a new conversation to get started"
          />
        ) : (
          <div className="flex flex-col gap-6 pb-8">
            <div className="flex items-center gap-4 mb-4">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search conversations..."
                  className="pl-9 focus-visible:ring-0 focus-visible:ring-offset-0"
                  value={conversations.search}
                  onChange={(e) => conversations.setSearch(e.target.value)}
                />
              </div>
              {/* Clear All Button */}
              {clearAllConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Delete all?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      await conversations.clearAllConversations();
                      setClearAllConfirm(false);
                    }}
                  >
                    Yes, Clear All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setClearAllConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive hover:border-destructive"
                  onClick={() => setClearAllConfirm(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>
            {sortedDates
              .filter((dateKey) =>
                conversations?.search?.length === 0
                  ? true
                  : groupedConversations?.[dateKey]?.some((doc) =>
                    doc?.title
                      .toLowerCase()
                      .includes(conversations?.search?.toLowerCase() || "")
                  )
              )
              .map((dateKey) => (
                <div key={dateKey} className="flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground select-none font-medium">
                    {moment(dateKey).format("ddd, MMM D")}
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    {groupedConversations[dateKey].map((doc) => (
                      <Card
                        key={doc.id}
                        className="shadow-none select-none p-4 gap-0 group relative transition-all !bg-black/5 dark:!bg-white/5 hover:!border-primary/50 cursor-pointer"
                        onClick={() => navigate(`/chats/view/${doc.id}`)}
                      >
                        <div className="flex items-center justify-between">
                          <p className="line-clamp-1 text-sm mr-8">
                            {doc.title}
                          </p>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-xs">
                              {doc.messageCount} messages
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {moment(doc.updatedAt).format("hh:mm A")}
                            </Badge>
                            {/* Trash button - appears on hover */}
                            <button
                              className="ml-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                conversations.handleDeleteConfirm(doc.id);
                              }}
                              title="Delete conversation"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <DeleteConfirmationDialog
          deleteConfirm={conversations.deleteConfirm}
          cancelDelete={conversations.cancelDelete}
          confirmDelete={conversations.confirmDelete}
        />
      </>
    </PageLayout>
  );
};

export default Dashboard;
